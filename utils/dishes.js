// 爱心小厨房 · 本地菜品服务（零后台可用）
//
// 为什么需要它：云开发数据库里的菜单需要「开通云开发 → 部署云函数 → 建集合 → 导数据」，
// 对零基础用户门槛太高。这里把 101 道菜内置进代码（seed），用户自己加的菜存本地（override），
// 两层合并后对外提供与云函数完全一致的 5 个 action，所以页面层代码一行都不用改。
//
// 数据分层：
//   seed         = data/dishes.js 里内置的 101 道菜（只读，永不被改写）
//   override     = 用户在应用内新增/编辑的菜（存 wx storage，按 id 覆盖 seed）
//   deletedIds   = 用户删掉的 seed 菜 id 黑名单（否则刷新后 seed 会让它「复活」）
//
// 约定：id 一律为纯数字（Number）。pages/checkout 用 Number(dataset.id) 做购物车加减，
//       字符串 id 会得到 NaN 导致加减失效，务必不要改成 "d001" 这类格式。

const seed = require('../data/dishes.js')

// 批量导入的字段规整规则与 CSV 解析共用一个实现（utils/csv.js），
// 避免「页面按 A 校验、服务按 B 校验」两边漂移。
const csv = require('./csv')

// 菜品操作日志：把「谁在什么时候动了菜单」传上云，掌勺人才看得到干饭人的改动。
//
// 为什么埋在这里而不是页面层：这里是**所有**改动的必经之路（加菜页、批量导入页、
// 将来任何新入口都走这几个 action），埋在这里才能保证「只要菜单变了就有日志」。
// 埋点的调用一律不 await —— record 内部全静默，写失败不影响本地改动。
const dishLogs = require('./dish-logs')
const { DEFAULT_SPICE } = require('./constants')

const STORAGE_KEY = 'dishes_override_v1'
const DELETED_KEY = 'dishes_deleted_v1'

// ---------- storage 读写（容错：storage 不可用时退化为纯内存，不影响当次会话） ----------

function readJSON(key, fallback) {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return fallback
    const v = wx.getStorageSync(key)
    if (v === '' || v === null || v === undefined) return fallback
    return v
  } catch (err) {
    console.warn('[dishes] 读取本地存储失败：' + key, err)
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return
    wx.setStorageSync(key, value)
  } catch (err) {
    console.warn('[dishes] 写入本地存储失败：' + key, err)
  }
}

function loadOverride() {
  const v = readJSON(STORAGE_KEY, [])
  return Array.isArray(v) ? v : []
}

function saveOverride(list) {
  writeJSON(STORAGE_KEY, list)
}

function loadDeletedIds() {
  const v = readJSON(DELETED_KEY, [])
  return Array.isArray(v) ? v.map(Number).filter(function (n) { return !isNaN(n) }) : []
}

function saveDeletedIds(list) {
  writeJSON(DELETED_KEY, list)
}

// ---------- 合并 ----------

/**
 * 合并 seed 与 override，剔除已删除项，按 created_at 升序（与云函数 orderBy created_at asc 一致）
 * @returns {Array<object>}
 */
function merged() {
  const override = loadOverride()
  const deleted = loadDeletedIds()
  const deletedMap = {}
  deleted.forEach(function (id) { deletedMap[id] = true })

  const byId = {}

  // 先铺 seed（只读底稿）
  seed.forEach(function (d) {
    const id = Number(d.id)
    if (deletedMap[id]) return
    byId[id] = Object.assign({}, d, { id: id })
  })

  // 再用 override 覆盖 / 追加（用户改过的字段以 override 为准）
  override.forEach(function (d) {
    const id = Number(d.id)
    if (isNaN(id)) return
    if (deletedMap[id]) return
    byId[id] = Object.assign({}, byId[id] || {}, d, { id: id })
  })

  const list = Object.keys(byId).map(function (k) { return byId[k] })
  list.sort(function (a, b) {
    const ca = Number(a.created_at) || 0
    const cb = Number(b.created_at) || 0
    if (ca !== cb) return ca - cb
    return Number(a.id) - Number(b.id)
  })
  return list
}

function findById(id) {
  const n = Number(id)
  if (isNaN(n)) return null
  const list = merged()
  for (let i = 0; i < list.length; i++) {
    if (Number(list[i].id) === n) return list[i]
  }
  return null
}

function nextId() {
  let max = 0
  merged().forEach(function (d) {
    const n = Number(d.id) || 0
    if (n > max) max = n
  })
  // 兜底：即使本地数据被清空，也不与 seed 的 1..101 冲突
  return Math.max(max, seed.length) + 1
}

// ---------- 5 个 action（返回值结构与云函数逐一对齐） ----------

// 对齐 cloudfunctions/lovekitchen/index.js 的 listDishes
function listDishes(event) {
  let list = merged()
  const category = event && event.category
  const keyword = event && event.keyword

  if (category && category !== '全部') {
    list = list.filter(function (d) { return d.category === category })
  }
  if (keyword) {
    const kw = String(keyword).trim().toLowerCase()
    if (kw) {
      list = list.filter(function (d) {
        return String(d.name || '').toLowerCase().indexOf(kw) >= 0 ||
               String(d.description || '').toLowerCase().indexOf(kw) >= 0
      })
    }
  }
  return { ok: true, dishes: list }
}

// 对齐 getDish
function getDish(event) {
  const id = event && event.id
  if (!id && id !== 0) throw new Error('缺少菜品 id')
  return { ok: true, dish: findById(id) }
}

// 对齐 saveDish：有 id 则增量 patch（只写明确传了的字段），无 id 则分配新 id 追加
function saveDish(event) {
  const payload = (event && event.payload) || {}
  const hasId = event && event.id !== undefined && event.id !== null && event.id !== ''

  // 只有新增才强制要名字；编辑允许只改某个字段（与页面层用法一致，也便于后续局部更新）
  if (!hasId && !payload.name) throw new Error('菜品名称不能为空')

  const override = loadOverride()
  const deleted = loadDeletedIds()

  if (hasId) {
    const id = Number(event.id)
    if (isNaN(id)) throw new Error('菜品 id 不合法')

    const idx = override.findIndex(function (d) { return Number(d.id) === id })
    const base = idx >= 0 ? override[idx] : (findById(id) || {})

    // 只覆盖明确传了的字段，避免部分更新把其它字段冲成默认值
    const patch = Object.assign({}, base, { id: id })
    if (payload.name !== undefined) patch.name = payload.name
    if (payload.category !== undefined) patch.category = payload.category
    if (payload.emoji !== undefined) patch.emoji = payload.emoji
    if (payload.spice !== undefined) patch.spice = payload.spice
    if (payload.description !== undefined) patch.description = payload.description
    patch.updated_at = Date.now()

    if (idx >= 0) override[idx] = patch
    else override.push(patch)
    saveOverride(override)

    // 若这 id 曾进过黑名单，本次编辑说明用户又要它了，移出黑名单
    const di = deleted.indexOf(id)
    if (di >= 0) {
      deleted.splice(di, 1)
      saveDeletedIds(deleted)
    }

    // 记日志：只列**真的变了**的字段。点了保存但什么都没改就不记 ——
    // 否则日志里会堆一串「什么都没发生」的记录，真正要紧的改动被淹掉
    const changes = dishLogs.fieldDiff(base, patch)
    if (changes.length) {
      dishLogs.record({
        action: 'update',
        dish_id: id,
        dish_name: patch.name,
        changes: changes,
      })
    }

    return { ok: true, id: String(id), created: false }
  }

  // 新增
  const id = nextId()
  const doc = {
    id: id,
    name: payload.name,
    category: payload.category || '经典热菜',
    emoji: payload.emoji || '🍴',
    spice: payload.spice || DEFAULT_SPICE,
    description: payload.description || '',
    created_at: Date.now(),
    updated_at: Date.now(),
  }
  override.push(doc)
  saveOverride(override)
  dishLogs.record({ action: 'add', dish_id: id, dish_name: doc.name })
  return { ok: true, id: String(id), created: true }
}

// 对齐 deleteDish：幂等（删不存在的也返回 ok，removed 为 0）
function deleteDish(event) {
  const id = event && event.id
  if (!id && id !== 0) throw new Error('缺少菜品 id')
  const n = Number(id)
  if (isNaN(n)) throw new Error('菜品 id 不合法')

  // 菜名快照必须在删掉**之前**取：删完再查就查不到了（override 里已移除，
  // seed 那条也可能刚被拉黑），日志就只剩一个光秃秃的 id，谁也看不懂
  const victim = findById(n)

  const override = loadOverride()
  const deleted = loadDeletedIds()
  const before = override.length
  const kept = override.filter(function (d) { return Number(d.id) !== n })

  let removed = before - kept.length
  if (removed > 0) saveOverride(kept)

  // 若来自 seed（且当前可见），记入黑名单，否则下次合并 seed 又会让它「复活」
  const alreadyDeleted = deleted.indexOf(n) >= 0
  const fromSeed = seed.some(function (d) { return Number(d.id) === n })
  const visibleInSeed = fromSeed && !alreadyDeleted

  if (visibleInSeed) {
    if (removed === 0) {
      // 这条菜只存在于 seed，写黑名单即等于删掉它
      deleted.push(n)
      saveDeletedIds(deleted)
      removed = 1
    } else {
      // 它同时被 override 改过：override 已删除，同时拉黑 seed，避免复活
      deleted.push(n)
      saveDeletedIds(deleted)
    }
  }

  // 真的删掉了才记日志：removed 为 0 说明这道菜本来就不在（重复删除是幂等的），
  // 这种情况记一笔「下架了 XX」就是假的
  if (removed > 0) {
    dishLogs.record({
      action: 'delete',
      dish_id: n,
      dish_name: (victim && victim.name) || '',
    })
  }

  // 幂等：重复删除返回 removed:0（对齐云函数 remove 的 stats.removed）
  return { ok: true, removed: removed }
}

// 对齐 stats（云函数返回 dishes/orders 总数；本地无订单库，orders 恒为 0）
function stats() {
  return { ok: true, dishes: merged().length, orders: 0 }
}

// 批量导入（CSV / 粘贴）：一次读、一次写
//
// 为什么不做成「页面循环调 saveDish」：
//   saveDish 每次都 loadOverride() + saveOverride()，导 200 道菜就是 400 次
//   同步存储读写 —— 真机上会明显卡住。这里同批只落一次盘。
//
// 条目约定：
//   · 带 id  → 更新那道菜（CSV 是权威来源，五个字段整体覆盖）
//   · 不带 id → 新增；但**若当前菜单里已有同名菜，则改为更新它**，
//              否则同一道菜会被导成两份，购物车里会出现两条一模一样的
function importDishes(event) {
  const list = (event && Array.isArray(event.items) ? event.items : []).filter(function (it) {
    return it && typeof it === 'object'
  })
  if (!list.length) throw new Error('没有要导入的菜')
  if (list.length > csv.IMPORT_MAX) {
    throw new Error('一次最多导入 ' + csv.IMPORT_MAX + ' 道菜')
  }

  const override = loadOverride()
  const deleted = loadDeletedIds()
  const deletedBefore = deleted.length

  // 当前可见的菜（seed + override - 黑名单）→ 菜名索引，用于同名判定
  const byName = {}
  merged().forEach(function (d) {
    const k = nameKey(d.name)
    if (k && byName[k] === undefined) byName[k] = d
  })

  // override 里各 id 的位置（同 id 只可能有一条）
  const posOf = {}
  override.forEach(function (d, i) {
    posOf[Number(d.id)] = i
  })

  // 新 id 从当前最大 id 往后排。批内用 cursor 递增，
  // 不能每条都调 nextId()（那会重算一遍 merged 并重复读盘）
  let cursor = seed.length
  Object.keys(byName).forEach(function (k) {
    const n = Number(byName[k].id) || 0
    if (n > cursor) cursor = n
  })

  const now = Date.now()
  const added = []
  const updated = []
  const skipped = []

  list.forEach(function (it, i) {
    const s = csv.sanitizeDish(it)
    if (!s.ok) {
      skipped.push({ name: String(it && it.name != null ? it.name : ''), reason: s.reason })
      return
    }
    const dish = s.dish
    const key = nameKey(dish.name)

    // 解析出目标 id：显式给了就用，否则按同名菜找
    let targetId = it.id === undefined || it.id === null || it.id === '' ? NaN : Number(it.id)
    if (isNaN(targetId)) {
      const hit = byName[key]
      targetId = hit ? Number(hit.id) : NaN
    }

    const at = posOf[targetId]

    let doc
    if (isNaN(targetId)) {
      cursor += 1
      doc = Object.assign({}, dish, { id: cursor, created_at: now + i, updated_at: now + i })
      override.push(doc)
      posOf[cursor] = override.length - 1
      added.push(dish.name)
    } else {
      // 编辑已有菜：以它当前的样子为底，再盖上 CSV 里的五个字段
      const base = at === undefined ? findById(targetId) || {} : override[at] || {}

      // 改名字时把旧名字从索引里撤掉，免得同一批后面的条目还按旧名找到它
      const oldKey = nameKey(base.name)
      if (oldKey && oldKey !== key && byName[oldKey] && Number(byName[oldKey].id) === targetId) {
        delete byName[oldKey]
      }

      doc = Object.assign({}, base, dish, {
        id: targetId,
        created_at: Number(base.created_at) || now + i,
        updated_at: now + i,
      })
      if (at === undefined) {
        override.push(doc)
        posOf[targetId] = override.length - 1
      } else {
        override[at] = doc
      }
      // 进过黑名单说明是被下架过的，这次导入即视为重新上架
      const di = deleted.indexOf(targetId)
      if (di >= 0) deleted.splice(di, 1)
      updated.push(dish.name)
    }
    byName[key] = doc
  })

  if (added.length || updated.length) saveOverride(override)
  if (deleted.length !== deletedBefore) saveDeletedIds(deleted)

  // 整批只记**一条**汇总日志，不逐道记：一次导 200 道菜若逐条写，
  // 日志瞬间被淹没，而掌勺人真正想知道的是「TA 一次往菜单里塞了两百道菜」。
  // skipped（格式不合被跳过）不算改动，不记。
  const touched = added.length + updated.length
  if (touched) {
    dishLogs.record({ action: 'import', dish_count: touched })
  }

  return {
    ok: true,
    added: added.length,
    updated: updated.length,
    skipped: skipped.length,
    skippedItems: skipped,
    total: merged().length,
  }
}

// 菜名归一化：判重名用它（去空白 + 忽略大小写）
function nameKey(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
}

// ---------- 路由 ----------

const ACTIONS = {
  listDishes: listDishes,
  getDish: getDish,
  saveDish: saveDish,
  deleteDish: deleteDish,
  importDishes: importDishes,
  stats: stats,
}

/**
 * 统一入口。返回值形状与云函数 main 一致：
 * 成功 { ok: true, ...data }；失败直接 throw（由 utils/api.js 的调用方 catch）
 * 注：云函数是返回 { ok: false, error }，api.js 会把 !ok 转成 throw，这里直接 throw 效果等价。
 */
function handle(action, payload) {
  const handler = ACTIONS[action]
  if (!handler) {
    throw new Error('本地不支持该 action: ' + action)
  }
  return handler(payload || {})
}

module.exports = {
  handle: handle,
  ACTIONS: ACTIONS,
  // 供测试 / 调试使用
  _internal: { merged: merged, nextId: nextId, loadOverride: loadOverride, loadDeletedIds: loadDeletedIds },
}
