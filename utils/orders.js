// 订单数据服务：WorkBuddy 云服务 · PostgreSQL（小程序直连）
//
// 为什么是这一套：
//   云开发自建环境要求「环境必须绑定当前小程序 AppID」，本项目用的是
//   平台代建的腾讯云账号环境，WxAppId 为空，绑定不上，所以整体换成
//   WorkBuddy 云服务 —— 它自带网关和授权，小程序端不需要任何密钥。
//
// 身份与权限：
//   小程序端没有 Origin，SDK 用 publishableKey + 微信 Referer 走环境网关；
//   行级权限（RLS）在数据库侧配置，订单表当前是「两人共享一份」的语义，
//   策略放开，因此谁能进小程序谁就能看全部订单 —— 这正是情侣点菜想要的效果。
//
// 字段与页面层的约定和历史上完全一致（id / items / created_at 毫秒数），
// 所以 pages/ 下所有页面零改动。

const TABLE = 'orders'

// 允许的订单状态（与 utils/constants.js 保持一致）
// rejected = 掌勺人驳回，必须带理由；它不是「推进」出来的，走 rejectOrder
const ORDER_STATUSES = ['pending', 'cooking', 'done']

// 用餐时间校验（日期范围 / 时段合法性）
const dine = require('./dine')

// 评价的收敛与合并规则（纯函数，与页面层共用同一套判定）
const reviewLib = require('./review')

// 驳回的判定与理由收敛（纯函数，与服务端共用同一份）
const rejectLib = require('./reject')

// 忌口的收敛规则（纯函数，与本地存储共用同一份）—— 忌口随订单一起送到掌勺人手上，
// 进库前必须再校一遍：本地存储可能是老版本写的、或者是手工改过 storage 的脏数据
const avoidsLib = require('./avoids')

// 每道菜备注的长度上限（与前端输入框保持一致）
const { DISH_NOTE_MAX } = require('./constants')

// 单次最多拉多少条订单。订单页是一次性拉全再本地筛选，
// 200 条足够很长一段时间的日常使用，超出后只显示最近的。
const MAX_ORDERS = 200

// ---------------------------------------------------------------------------
// 云服务初始化参数
//
// 这两个值是「公开发布密钥」和「环境网关地址」，可以放在前端代码里：
//   · publishableKey 只标识「是哪个应用」，本身不带任何权限；
//   · endpoint 是小程序专用固定网关，不能改写成别的域名。
// 真正有权力的密钥全部留在服务端，永远不会下发到小程序。
//
// ⚠️ 这两个值只能来自云服务开通结果，不要手工改写、不要从别处猜。
// ---------------------------------------------------------------------------
const PUBLIC_CONFIG = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_Q7J8UvVewXzjOG0IpQ4004_YvTgzvQz246XbF58PqpMDb7AO7mrwPjs',
}

// 数据库 SDK 的加载。
//
// 优先用相对路径直接指向构建产物（miniprogram_npm/...），这样完全不依赖
// 微信工具的 npm 解析规则 —— 万一「构建 npm」状态异常也不会报
// 「暂不支持 npm 模块」。只有该文件缺失时才回退到按包名加载。
//
// 注意：require 的路径必须是静态字符串，小程序才能做依赖分析。
function loadSDK() {
  try {
    // 小程序专用子路径（含 wx.request / 存储 / polyfill 的完整装配，顺序由 SDK 保证）
    return require('../miniprogram_npm/@tencent-ai/workbuddy-cloud-sdk/index.js')
  } catch (e) {
    // 回退：交给小程序的 npm 解析
    try {
      return require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
    } catch (e2) {
      throw new Error(
        '找不到云服务 SDK。请确认项目里存在 ' +
          'miniprogram_npm/@tencent-ai/workbuddy-cloud-sdk/index.js' +
          '（或在开发者工具执行「工具 → 构建 npm」）。原始错误：' +
          ((e2 && e2.message) || e2)
      )
    }
  }
}

// 诊断包装：把失败的云请求打到手机 vConsole，方便真机排查。
// 它只记录失败摘要（方法/地址/状态码/错误码），不记录请求体、凭据和完整响应。
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

const { createMiniProgramWorkBuddyCloud } = loadSDK()

let _cloud = null

// 懒初始化：首次调用时才建立客户端；同一个实例被所有 action 复用
function getCloud() {
  if (_cloud) return _cloud

  if (typeof wx === 'undefined' || !wx) {
    throw new Error('当前不在小程序环境里（找不到 wx 对象），云服务无法初始化。')
  }

  try {
    _cloud = createMiniProgramWorkBuddyCloud({
      // 两个值都必传：小程序没有 location.origin，SDK 的同源兜底在这里不存在，
      // 漏掉 endpoint 会在初始化阶段直接失败。
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey,
      // 只包这一层，不改全局 wx.request，也不碰 SDK 的请求/鉴权逻辑
      wx: createDiagnosticWx(wx),
    })
  } catch (err) {
    // 初始化失败不缓存，允许下次重试
    _cloud = null
    throw new Error('云服务初始化失败：' + ((err && (err.message || err.errMsg)) || err))
  }

  return _cloud
}

function getDB() {
  return getCloud().database
}

// PG 的 timestamptz 取回来是 ISO 字符串，而页面层 formatTime 期望毫秒数
function toMillis(v) {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return isNaN(t) ? 0 : t
}

// items 用 jsonb 存，SDK 会自动解析成数组；这里做一层兜底
function parseItems(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }
  return []
}

// reviews 同样用 jsonb 存（键 = 菜品行标识），兜底成「空对象」
function parseReviews(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (e) {
      return {}
    }
  }
  return {}
}

// avoids 也是 jsonb 数组（干饭人的忌口清单），兜底成空数组 + 逐条收敛
// 收敛放在读出来的这一侧：库里万一进了老版本写的脏数据，页面拿到的仍是干净数组
function parseAvoids(raw) {
  if (Array.isArray(raw)) return avoidsLib.normalize(raw)
  if (typeof raw === 'string') {
    try {
      return avoidsLib.normalize(JSON.parse(raw))
    } catch (e) {
      return []
    }
  }
  return []
}

// 数据库行 → 页面层期望的结构
function rowToOrder(row) {
  const id = String(row.id)
  return {
    _id: id,
    id: id,
    items: parseItems(row.items),
    remark: row.remark || '',
    order_by: row.order_by || '宝贝',
    status: row.status || 'pending',
    // 用餐时间：老订单可能没有（NULL → 空串），页面层自行兜底
    dine_date: row.dine_date || '',
    dine_slot: row.dine_slot || '',
    // 忌口快照：下单那一刻干饭人的清单（落库快照，事后改忌口不倒推历史订单）
    avoids: parseAvoids(row.avoids),
    // 驳回：reason 只在 status === 'rejected' 时展示，at 是驳回时刻（毫秒，老订单为 0）
    reject_reason: row.reject_reason || '',
    rejected_at: toMillis(row.rejected_at),
    // 逐道菜的评价：{ "dishId|辣度": { rating, tags, text, by, at } }
    reviews: parseReviews(row.reviews),
    created_at: toMillis(row.created_at),
    updated_at: toMillis(row.updated_at),
  }
}

// 用餐时间 → 只接受合法值，非法直接报错（日期今天～一周内，时段四选一）
function normalizeDine(payload) {
  const dineDate = payload.dine_date
  const dineSlot = payload.dine_slot
  const err = dine.validate(dineDate, dineSlot, new Date())
  if (err) throw new Error(err)
  return {
    dine_date: dineDate ? dineDate : null,
    dine_slot: dineSlot ? dineSlot : null,
  }
}

// 页面层传来的菜品清单 → 只保留该存的字段，避免脏数据进库
// note 是「这一道菜」的备注（比如「不放葱」），与订单级 remark 是两回事
function normalizeItems(raw) {
  const items = Array.isArray(raw) ? raw : []
  return items.map(function (it) {
    return {
      dishId: it.dishId,
      name: it.name,
      emoji: it.emoji,
      spice: it.spice || '不辣',
      // 只接受字符串备注：脏数据（数字 / 对象）一律当没写
      note:
        typeof it.note === 'string'
          ? it.note.trim().slice(0, DISH_NOTE_MAX)
          : '',
      qty: Number(it.qty) || 1,
    }
  })
}

// 统一处理 SDK 返回：出错就抛，交给调用方 catch
//
// 除了 SDK 自己报的 error，这里还识别一类「静默失败」：
// 写操作（更新/删除）被 RLS 拦截时，SDK 返回的 data 是空数组而不是错误，
// 如果不额外判断，页面会误以为成功了 —— 所以写操作另用 requireAffected 校验。
function unwrap(res) {
  if (res && res.error) {
    const e = res.error
    const msg = (e && (e.message || e.code)) || '数据库操作失败'
    throw new Error(msg)
  }
  return res || {}
}

// 写操作用：确认真的影响了行数，空数组说明没改到（多半是权限或记录不存在）
function affectedRows(res) {
  const out = unwrap(res)
  return Array.isArray(out.data) ? out.data : []
}

async function listOrders() {
  const res = unwrap(
    await getDB()
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, MAX_ORDERS - 1)
  )
  const rows = Array.isArray(res.data) ? res.data : []
  return { orders: rows.map(rowToOrder) }
}

async function getOrder(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const res = unwrap(await getDB().from(TABLE).select('*').eq('id', id).limit(1))
  const rows = Array.isArray(res.data) ? res.data : []
  return { order: rows.length ? rowToOrder(rows[0]) : null }
}

async function createOrder(event) {
  const payload = (event && event.payload) || {}
  const items = normalizeItems(payload.items)
  if (!items.length) throw new Error('订单里没有菜品')

  const dineFields = normalizeDine(payload)
  const row = {
    items: items,
    remark: payload.remark || '',
    order_by: payload.order_by || '宝贝',
    status: 'pending',
    dine_date: dineFields.dine_date,
    dine_slot: dineFields.dine_slot,
    // 忌口快照：下单那一刻的清单跟着订单一起冻结。
    // 掌勺人手机读不到干饭人的本地存储，忌口只有上云对方才看得见；
    // 没记忌口就是空数组，掌勺人那边什么都不显示（不留空壳）。
    avoids: avoidsLib.normalize(payload.avoids),
  }

  const res = unwrap(await getDB().from(TABLE).insert(row).select())
  const inserted = Array.isArray(res.data) && res.data.length ? res.data[0] : null
  if (!inserted) throw new Error('订单没能写入，请稍后再试')
  return { id: String(inserted.id) }
}

// 编辑订单：菜品清单全量替换（页面每次提交完整清单）+ 备注 / 署名 / 用餐时间 / 忌口
//
// 谁能改：只有下单的人（干饭人）。掌勺人只推进状态或驳回，改内容一律不认 ——
// 这条规则由页面层拦（订单页不给入口、编辑页对掌勺人退化成只读），
// 服务端再兜一道状态机，两头都不会漏。
//
// 服务端的三个兜底：
//   · 已上菜（done）的单不能再改 —— 菜都端上桌了；
//   · 开做中（cooking）的单也不能再改 —— 掌勺人已经开火了，改了菜就是给人添乱；
//   · **不接受 status 字段**。状态是掌勺人的事，页面传了也不认；
//     若这一单原本是「已驳回」，改完内容自动退回「待开做」= 重新提交。
async function updateOrder(event) {
  const id = event && event.id
  const payload = (event && event.payload) || {}
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const items = normalizeItems(payload.items)
  if (!items.length) throw new Error('订单里没有菜品')

  // 先读现状：既用来拦终态 / 开做中，也用来判断这次改动算不算「重新提交」
  const cur = unwrap(await getDB().from(TABLE).select('id, status').eq('id', id).limit(1))
  const curRows = Array.isArray(cur.data) ? cur.data : []
  if (!curRows.length) throw new Error('这一单不存在了')
  const status = curRows[0].status || 'pending'
  if (status === 'done') throw new Error('这一单已经上菜了，不能再改')
  if (status === 'cooking') throw new Error('这一单正在做，等做完这顿再说吧')

  const patch = {
    items: items,
    remark: payload.remark || '',
    order_by: payload.order_by || '宝贝',
    updated_at: new Date().toISOString(),
  }

  // 被驳回的单改完就是重新提交：状态回到待开做，并把上一次的驳回理由清掉
  // （理由留着会让人以为「又驳回了」，而这一单其实已经在等掌勺人开做）
  if (status === 'rejected') {
    patch.status = 'pending'
    patch.reject_reason = ''
    patch.rejected_at = null
  }

  // 用餐时间：传了才改（保持与编辑页的字段一致）；undefined 表示这次不动它
  if (payload.dine_date !== undefined || payload.dine_slot !== undefined) {
    const dineFields = normalizeDine(payload)
    patch.dine_date = dineFields.dine_date
    patch.dine_slot = dineFields.dine_slot
  }

  // 忌口：同样「传了才改」。编辑页会带上最新清单（改完菜顺手把忌口也更新一遍），
  // 而万一有别的调用方不带这个字段，也不该把已有忌口抹成空 —— 那等于告诉掌勺人「TA 什么都吃」。
  if (payload.avoids !== undefined) {
    patch.avoids = avoidsLib.normalize(payload.avoids)
  }

  const rows = affectedRows(await getDB().from(TABLE).update(patch).eq('id', id).select())
  if (!rows.length) throw new Error('这一单没能保存，可能已经被删掉了')
  return { updated: rows.length, status: patch.status || status }
}

// 推进订单状态（只有掌勺人的活）：待开做 → 开做中 → 已上菜，
// 或者把误驳回的单「收回」回到待开做。
//
// 驳回不从这里走：驳回必须带一句理由，走 rejectOrder。
// 干饭人没有任何一条路径能到这个 action —— 页面层不给状态开关，这里也不认 rejected。
async function updateOrderStatus(event) {
  const id = event && event.id
  const status = event && event.status
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')
  if (ORDER_STATUSES.indexOf(status) < 0) {
    if (status === 'rejected') throw new Error('驳回要写一句理由，请用「驳回」按钮')
    throw new Error('订单状态不合法')
  }

  const rows = affectedRows(
    await getDB()
      .from(TABLE)
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
  )
  if (!rows.length) throw new Error('这一单没能更新，可能已经被删掉了')
  return { updated: rows.length }
}

// 驳回（只有掌勺人能做，且必须写理由）
//
// 状态机：待开做 / 开做中 → 已驳回。已上菜不能驳（菜都端上桌了），
// 已驳回不用再驳一次。驳回后球回到干饭人那边：他改完菜重新提交
// （updateOrder）就自动回到「待开做」。
async function rejectOrder(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const reason = rejectLib.normalizeReason(event && event.reason)
  if (!reason) throw new Error('驳回要写一句理由哦')

  const cur = unwrap(await getDB().from(TABLE).select('id, status').eq('id', id).limit(1))
  const curRows = Array.isArray(cur.data) ? cur.data : []
  if (!curRows.length) throw new Error('这一单不存在了')

  const status = curRows[0].status || 'pending'
  if (!rejectLib.canReject(status)) {
    throw new Error(status === 'done' ? '这一单已经上菜了，没法驳回' : '这一单已经是驳回状态了')
  }

  const now = new Date().toISOString()
  const rows = affectedRows(
    await getDB()
      .from(TABLE)
      .update({ status: 'rejected', reject_reason: reason, rejected_at: now, updated_at: now })
      .eq('id', id)
      .select()
  )
  if (!rows.length) throw new Error('这一单没能驳回，可能已经被删掉了')
  return { updated: rows.length, reason: reason }
}

async function deleteOrder(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  // 先看状态：开做中的单不能删 —— 掌勺人正在做这顿饭，删了就白做了，
  // 等上菜之后随删。待开做 / 已驳回照常能删（还没开火，删了就是不想吃了）。
  const cur = unwrap(await getDB().from(TABLE).select('id, status').eq('id', id).limit(1))
  const curRows = Array.isArray(cur.data) ? cur.data : []
  if (!curRows.length) throw new Error('这一单不存在了')
  if ((curRows[0].status || 'pending') === 'cooking') {
    throw new Error('这一单正在做，等做完再删吧')
  }

  const rows = affectedRows(await getDB().from(TABLE).delete().eq('id', id).select())
  if (!rows.length) throw new Error('这一单没能删除，可能已经被删掉了')
  return { removed: rows.length }
}

// 保存一道菜的评价（单条 upsert / 删除）
//
// 为什么是「单条」而不是「整表覆盖」：
//   评价是一道一道说的，一次只改一行；服务端按 key 合并现有 JSONB，
//   两个人（或两台设备）同时评价不同的菜时不会互相覆盖。
//
// review 传 null / 星级为 0 → 视为「撤销这一条评价」。
async function saveReview(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const key = String((event && event.key) || '')
  if (!key) throw new Error('缺少菜品标识')

  const cur = unwrap(await getDB().from(TABLE).select('id, status, items, reviews').eq('id', id).limit(1))
  const rows = Array.isArray(cur.data) ? cur.data : []
  if (!rows.length) throw new Error('这一单不存在了')

  // 服务端也拦一道：只有「已上菜」的单能评，别指望前端自觉
  if ((rows[0].status || '') !== 'done') throw new Error('这一单还没上菜，先等掌勺人做完哦')

  const input = (event && event.review) || null
  const rating = input ? reviewLib.normalizeRating(input.rating) : 0

  // 打分时校验「这道菜确实在这一单里」：前端键规则一旦和这里漂移，
  // 就会写出一堆永远显示不出来的孤儿评价 —— 宁可当场报错，也别默默存脏数据。
  // 撤销（rating 为 0）不校验，方便清掉历史遗留的孤儿条目。
  if (rating > 0) {
    const items = parseItems(rows[0].items)
    const exists = items.some(function (it) {
      return reviewLib.itemKey(it) === key
    })
    if (!exists) throw new Error('这道菜不在这一单里')
  }

  const before = reviewLib.normalizeReviews(rows[0].reviews)

  const after =
    rating > 0
      ? reviewLib.putReview(before, key, {
          rating: rating,
          tags: input.tags,
          text: input.text,
          by: input.by || '',
          at: input.at || new Date().toISOString(),
        })
      : reviewLib.dropReview(before, key)

  const out = affectedRows(
    await getDB()
      .from(TABLE)
      .update({ reviews: after, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
  )
  if (!out.length) throw new Error('评价没能保存，可能这一单已经被删掉了')
  return { reviews: after }
}

async function stats() {
  const res = unwrap(await getDB().from(TABLE).select('*', { count: 'exact', head: true }))
  return { orders: typeof res.count === 'number' ? res.count : 0 }
}

// action 路由表：与 utils/api.js 的 ORDER_ACTIONS 对应
const ACTIONS = {
  listOrders: listOrders,
  getOrder: getOrder,
  createOrder: createOrder,
  updateOrder: updateOrder,
  updateOrderStatus: updateOrderStatus,
  rejectOrder: rejectOrder,
  deleteOrder: deleteOrder,
  saveReview: saveReview,
  stats: stats,
}

async function handle(action, payload) {
  const fn = ACTIONS[action]
  if (!fn) throw new Error('未知的订单 action: ' + action)
  return fn(payload || {})
}

module.exports = { handle, ACTIONS, PUBLIC_CONFIG, TABLE }
