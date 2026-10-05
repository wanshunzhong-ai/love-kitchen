// 菜品操作日志：谁在什么时候动了菜单
//
// 背景：菜品库是「本地优先」的（见 utils/dishes.js 顶部说明）—— seed 内置在代码里、
// 用户改动写各自手机的 wx storage。于是干饭人加菜 / 改菜 / 下架，掌勺人的手机完全无感，
// 永远不知道 TA 动过菜单。这份日志是唯一能把「TA 做过什么」传过去的通道，
// 所以它必须走云端（与订单、忌口同理：跨设备的信息只有上了云对方才读得到）。
//
// 两条硬约束：
//   1. **写日志绝不影响主流程**。record() 内部全静默：日志写不进去就当作没发生，
//      绝不能因为云端不可用就让「加菜」失败 —— 菜品库是本地功能，必须离线可用。
//   2. **规则只有一份**。动作枚举、字段中文名、文案生成都收在这里，
//      页面层只渲染、utils/dishes.js 只埋点，谁都不另写一套。

const { getDB, unwrap } = require('./cloud')
const store = require('./store')
const { formatDayLabel } = require('./format')
const { DEFAULT_NAME } = require('./constants')

const TABLE = 'dish_logs'

// 日志页一次最多取多少条（与 orders 的 MAX_ORDERS 同样是一次性拉全再本地筛）
const MAX_LOGS = 200

// 默认只看最近多少天的日志（清单 C29）。
//
// 这张表是 append-only 的，没有任何删除策略 —— 用得越久越长。不加时间窗的话，
// 每次进日志页都要把整表拉下来再在本地按天分组，页会越来越慢。
// 留一个窗口 + 一个「看更早的」入口，比一次性拉全更稳（真要全量也能手动扩）。
const DEFAULT_DAYS = 30

// 窗口最多能扩到多少天（防手抖传个离谱的数把整表拖下来）
const DAYS_MAX = 365

const DAY_MS = 24 * 60 * 60 * 1000

/** 把传进来的 days 收敛成合法窗口：没传 / 非法 / 非正数 → 默认窗口 */
function clampDays(value) {
  const n = Number(value)
  if (!n || isNaN(n) || n <= 0) return DEFAULT_DAYS
  return Math.min(Math.floor(n), DAYS_MAX)
}

// 动作枚举：与数据库 dish_logs_action_check 约束保持一致，加新动作时两边一起改
const ACTIONS = ['add', 'update', 'delete', 'import']

// 每个动作的图标与动词短语（文案只在这张表里定义）
const ACTION_META = {
  add: { emoji: '➕', verb: '加了' },
  update: { emoji: '✏️', verb: '改了' },
  delete: { emoji: '🗑️', verb: '下架了' },
  import: { emoji: '📥', verb: '批量导入了' },
}

/**
 * 菜品字段的中文名。
 *
 * 键的顺序 = 展示顺序（改菜时按这个顺序列变化），也就是重要性顺序。
 * 日志里存的是**中文名快照**而不是字段键：流水是给人看的，
 * 将来字段改名了，历史日志仍然读得懂（审计日志的第一要务）。
 */
const FIELD_LABELS = {
  name: '菜名',
  category: '分类',
  spice: '辣度',
  emoji: '图标',
  description: '介绍',
}

// 各字段在日志里的长度上限（介绍可能很长，截断后再入库存下来，页面不必再处理）
const FIELD_MAX = 24
const DISH_NAME_MAX = 30
const NAME_MAX = 12

// ---------- 纯函数（不碰 wx / 云端，便于直接测） ----------

function clip(value, max) {
  const s = value === null || value === undefined ? '' : String(value)
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function toId(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return isNaN(n) ? null : n
}

/** 空值在界面上显示成「（空）」，否则会出现「菜名： → 红烧肉」这种读不懂的箭头 */
function showVal(v) {
  return v === '' ? '（空）' : v
}

/**
 * 比对改动前后的菜品，产出 [{ field: '菜名', from: '红烧排骨', to: '糖醋排骨' }]
 *
 * 只列**真的变了**的字段。按键的定义顺序输出，保证同一次改动每次看到一样的顺序。
 */
function fieldDiff(before, after) {
  const a = before || {}
  const b = after || {}
  const out = []
  Object.keys(FIELD_LABELS).forEach(function (key) {
    const from = a[key] === null || a[key] === undefined ? '' : String(a[key])
    const to = b[key] === null || b[key] === undefined ? '' : String(b[key])
    if (from !== to) {
      out.push({
        field: FIELD_LABELS[key],
        from: clip(from, FIELD_MAX),
        to: clip(to, FIELD_MAX),
      })
    }
  })
  return out
}

/** 把（可能来自存储的脏）变化数组收敛成规范形状 */
function normalizeChanges(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] || {}
    const field = clip(it.field, 8)
    if (!field) continue
    out.push({
      field: field,
      from: clip(it.from, FIELD_MAX),
      to: clip(it.to, FIELD_MAX),
    })
  }
  return out
}

/**
 * 日志行 → 页面可渲染的文案。
 *
 * @returns {{emoji:string, action:string, title:string, detailLines:string[], isOrderer:boolean}}
 */
function describe(row) {
  const r = row || {}
  const action = ACTIONS.indexOf(r.action) >= 0 ? r.action : 'update'
  const meta = ACTION_META[action]
  const name = clip(r.dish_name, DISH_NAME_MAX)

  let title
  if (action === 'import') {
    const n = Math.max(1, Number(r.dish_count) || 1)
    title = meta.verb + ' ' + n + ' 道菜'
  } else {
    title = meta.verb + '「' + (name || '未命名') + '」'
  }

  // 改菜才列变化；加菜 / 下架 / 导入只有一种结果，列出来反而喧宾夺主
  const detailLines = action === 'update'
    ? normalizeChanges(r.changes).map(function (c) {
        return c.field + ' ' + showVal(c.from) + ' → ' + showVal(c.to)
      })
    : []

  return {
    emoji: meta.emoji,
    action: action,
    title: title,
    detailLines: detailLines,
    // 干饭人动的 → 页面上高亮（这是掌勺人最想一眼看到的那类）
    isOrderer: r.by_role !== 'cook',
  }
}

/**
 * 按天分组：[{ label: '今天', logs: [...] }, { label: '昨天', logs: [...] }, ...]
 *
 * 输入需已按时间倒序（list() 保证），这里只做切分，不重排。
 */
function groupByDay(rows, nowTs) {
  const list = Array.isArray(rows) ? rows : []
  const groups = []
  let cur = null
  list.forEach(function (r) {
    const label = formatDayLabel(r.created_at, nowTs)
    if (!cur || cur.label !== label) {
      cur = { key: label, label: label, logs: [] }
      groups.push(cur)
    }
    cur.logs.push(r)
  })
  return groups
}

// ---------- 身份 ----------

/** 当前是谁在操作（nickname 可能为空 —— 两台手机都还没设过称呼） */
function identity() {
  try {
    const role = store.getRole() === 'cook' ? 'cook' : 'orderer'
    const name = store.getNickname(role) || ''
    return { role: role, name: clip(name, NAME_MAX) || (role === 'cook' ? '掌勺人' : DEFAULT_NAME) }
  } catch (err) {
    return { role: 'orderer', name: DEFAULT_NAME }
  }
}

// ---------- 读写 ----------

/** 收敛成一行入库数据；动作不合法则返回 null（宁可不记，也不要写脏数据进去） */
function normalize(entry) {
  const e = entry || {}
  const action = ACTIONS.indexOf(e.action) >= 0 ? e.action : null
  if (!action) return null

  const who = e.by_role ? { role: e.by_role, name: e.by_name } : identity()

  return {
    action: action,
    dish_id: toId(e.dish_id),
    dish_name: clip(e.dish_name, DISH_NAME_MAX),
    changes: action === 'update' ? normalizeChanges(e.changes) : [],
    dish_count: Math.max(1, Number(e.dish_count) || 1),
    by_role: who.role === 'cook' ? 'cook' : 'orderer',
    by_name: clip(who.name, NAME_MAX) || DEFAULT_NAME,
  }
}

/**
 * 记一条日志。**永远不抛错**（这是本模块最重要的约定）。
 *
 * 返回 Promise，但调用方不需要 await —— 埋点处直接 `dishLogs.record({...})` 即可，
 * 不阻塞本地的加菜流程。写失败只在控制台留个影子，不打到用户界面上：
 * 「日志没记上」对用户没有可操作性，为它弹个报错反而莫名其妙。
 */
// 失败提示只打一次：真机上日志写不进去（断网 / 未构建 npm）会伴随每一次加菜发生，
// 每回都刷屏反而盖住了其它有用的日志。
let _warned = false

function warnOnce(msg) {
  if (_warned) return
  _warned = true
  console.warn('[dish-logs] ' + msg + '（只提示这一次）')
}

async function record(entry) {
  // 纯 Node 环境（没有 wx）不可能连得上云 —— 直接跳过，连试都不必试。
  // 这让 utils/dishes.js 在单测和静态检查里保持「零云端依赖」。
  if (typeof wx === 'undefined' || !wx) return null

  try {
    const row = normalize(entry)
    if (!row) {
      warnOnce('未知动作，已跳过：' + ((entry && entry.action) || '(空)'))
      return null
    }
    const res = unwrap(await getDB().from(TABLE).insert(row).select())
    const saved = Array.isArray(res.data) && res.data.length ? res.data[0] : null
    // 与订单同理：被 RLS 拦下时返回的是空数组而不是错误，不校验会「以为记上了却没记」
    if (!saved) warnOnce('日志没有写入（可能被权限拦下）')
    return saved
  } catch (err) {
    warnOnce('日志写入跳过：' + ((err && err.message) || err))
    return null
  }
}

/**
 * 取日志列表（最新在前）。
 *
 * 两道闸门，都会把拉取量按住（清单 C29）：
 *   ① 时间窗：`event.days`（默认 DEFAULT_DAYS 天，用 clampDays 收敛）——
 *      append-only 的表没有删除策略，不设窗口的话页会随使用时间越来越慢；
 *   ② 条数上限：MAX_LOGS，窗口内也可能很多条。
 * 返回值带上实际用的窗口与「是否顶到条数上限」，页面据此提示 + 给「看更早的」入口。
 *
 * 读失败会抛错，由页面给出重试入口。
 */
async function list(event) {
  const e = event || {}
  const want = Number(e.limit)
  const limit = Math.min(Math.max(1, isNaN(want) ? MAX_LOGS : want), MAX_LOGS)
  const days = clampDays(e.days)
  const since = new Date(Date.now() - days * DAY_MS).toISOString()

  const res = unwrap(
    await getDB()
      .from(TABLE)
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(0, limit - 1)
  )

  const rows = Array.isArray(res.data) ? res.data : []
  return {
    logs: rows.map(rowToLog),
    days: days,
    limit: limit,
    // 顶到条数上限 → 窗口里还有更早的没拿到（页面提示「只显示了最近 N 条」）
    capped: rows.length >= limit,
  }
}

/** 数据库行 → 页面层结构（时间统一成毫秒数，与 orders 的处理一致） */
function rowToLog(row) {
  const r = row || {}
  return {
    id: String(r.id),
    action: r.action,
    dish_id: r.dish_id === null || r.dish_id === undefined ? null : Number(r.dish_id),
    dish_name: r.dish_name || '',
    changes: normalizeChanges(r.changes),
    dish_count: Number(r.dish_count) || 1,
    by_role: r.by_role === 'cook' ? 'cook' : 'orderer',
    by_name: r.by_name || '',
    created_at: toMillis(r.created_at),
  }
}

function toMillis(v) {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const t = new Date(String(v).replace(' ', 'T')).getTime()
  return isNaN(t) ? 0 : t
}

// action 路由表：与 utils/api.js 的 LOG_ACTIONS 对应
const HANDLERS = {
  listDishLogs: list,
}

/** 统一入口，形态与 utils/dishes.js / utils/orders.js 一致：成功给数据，失败直接 throw */
function handle(action, payload) {
  const fn = HANDLERS[action]
  if (!fn) throw new Error('日志模块不支持该 action: ' + action)
  return fn(payload || {})
}

module.exports = {
  TABLE,
  MAX_LOGS,
  DEFAULT_DAYS,
  DAYS_MAX,
  clampDays,
  ACTIONS,
  handle,
  HANDLERS,
  ACTION_META,
  FIELD_LABELS,
  fieldDiff,
  normalizeChanges,
  normalize,
  describe,
  groupByDay,
  identity,
  record,
  list,
  rowToLog,
}
