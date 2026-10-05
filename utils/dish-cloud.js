// 共享菜品增量层：把「掌勺人新增的菜」传上云，让干饭人的点单页也能看到（清单 C28/C30）
//
// 为什么需要它（先看这条，否则很容易把它当成为什么不把整个菜单都搬上云）：
//
//   303 道内置菜（data/dishes.js）**本来就在两个人的手机上各有一份**，是同一份，
//   不需要同步。真正对不齐的只有「有人在应用里加的菜 / 改的菜」——那部分写各自手机的
//   wx storage。于是：
//
//     干饭人加菜 → 掌勺人：**已经通了**。下单时 orders.items 是快照，菜名跟着订单过去，
//                          另外还有 dish_logs 这条审计流水。
//     掌勺人加菜 → 干饭人：**完全不通**。干饭人「点单」页读的是自己手机的菜单，
//                          掌勺人本地加的菜他根本看不到、点不到。
//
//   这张表就补**后面那一条**：掌勺人新增的菜进云端，两台手机都合并进来。
//
// 四条设计约定（改之前先读）：
//
//   1. **只单向**。只有掌勺人的新增会推上去；干饭人加的菜仍只在他自己手机上
//      （他要吃的话下单时会带过去，掌勺人看得到）。所以这里没有冲突处理 ——
//      两个人不会同时改同一道云端菜。
//
//   2. **id 由云端发号**，落在 constants.CLOUD_ID_BASE 之后的号段（见那里的说明）。
//      本地新菜先按本地号段落盘（离线可用），推上去之后**换成云端的 id**
//      （utils/dishes.js::flushPending 里的 rekey）—— 这样两台手机上同一道菜是同一个 id。
//
//   3. **网络失败一律静默**。菜单是本地功能，读菜、改内置菜必须离线可用。
//      这里所有网络函数失败都返回 null / false，**从不抛错**；推送失败的行会留一个
//      pendingSync 标记，等下一次 sync() 再推（与 utils/dish-logs.js 的 record 同款约定）。
//
//   4. **合并规则只在这一份实现**（mergeInto 是纯函数，不碰 wx / 云端，可直接单测）。
//      两台手机跑的是同一套规则。

const { getDB, unwrap } = require('./cloud')
const { CLOUD_ID_BASE, DEFAULT_SPICE } = require('./constants')

const TABLE = 'dishes'

// 本地菜品行里由本模块维护的标记（写进 storage，不推给云端）
//   pendingSync —— 本地有改动还没推上去（新增：id 还在本地号段；改：id 已是云端号段）
//   localEdited —— 本机改过这道云端菜，拉取时**不要**用云端值覆盖（本地优先）
const PENDING = 'pendingSync'
const EDITED = 'localEdited'

/** 是不是云端号段的 id（≥ CLOUD_ID_BASE 的菜都由这张表发号） */
function isCloudId(id) {
  const n = Number(id)
  return !isNaN(n) && n >= CLOUD_ID_BASE
}

// ---------- 形状转换 ----------

/** 云表行 → 本地菜品结构（created_at / updated_at 统一成毫秒数，与 orders 一致） */
function rowToDish(row) {
  const r = row || {}
  const id = Number(r.id)
  if (isNaN(id)) return null
  return {
    id: id,
    name: r.name || '',
    category: r.category || '其他',
    emoji: r.emoji || '🍴',
    spice: r.spice || DEFAULT_SPICE,
    description: r.description || '',
    created_at: toMillis(r.created_at),
    updated_at: toMillis(r.updated_at),
    // 标记「这道菜来自云端」，页面/调试一眼能看出来源（也用于列表上标一句「掌勺人加的」）
    fromCloud: true,
  }
}

/** 本地菜品 → 入库行。**只推这四个业务字段**，本地号段的 id 与标记一律不带。 */
function dishToRow(dish, byName) {
  const d = dish || {}
  return {
    name: String(d.name || ''),
    category: String(d.category || '其他'),
    emoji: String(d.emoji || '🍴'),
    spice: String(d.spice || DEFAULT_SPICE),
    description: String(d.description || ''),
    by_name: String(byName || ''),
  }
}

function toMillis(v) {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const t = new Date(String(v).replace(' ', 'T')).getTime()
  return isNaN(t) ? 0 : t
}

// ---------- 纯函数：合并规则（唯一定义） ----------

/**
 * 把云端增量合并进本地覆盖层。**纯函数**：不改入参，返回新数组。
 *
 * 三条规则，按顺序判断：
 *   ① 本地拉黑过这个 id（干饭人删过掌勺人加的菜）→ 跳过，别让它复活。
 *   ② 本地已有这个 id 且 `localEdited` → 跳过，本机改过的以本机为准（本地优先）。
 *   ③ 否则：没有就插入，有就按云端字段更新（掌勺人改了名 / 辣度，对方要跟着变）。
 *
 * 内置 seed 的 id（1..303）永远不在云端表里，所以这套规则**碰不到内置菜**。
 *
 * @returns {{override:Array, deleted:Array, added:number, updated:number, changed:boolean}}
 */
function mergeInto(override, deletedIds, rows) {
  const out = (Array.isArray(override) ? override : []).map(function (d) {
    return Object.assign({}, d)
  })
  const del = (Array.isArray(deletedIds) ? deletedIds : []).slice()
  const delSet = {}
  del.forEach(function (id) { delSet[Number(id)] = true })

  const posOf = {}
  out.forEach(function (d, i) { posOf[Number(d.id)] = i })

  let added = 0
  let updated = 0

  const list = Array.isArray(rows) ? rows : []
  list.forEach(function (row) {
    const id = Number(row && row.id)
    if (isNaN(id)) return
    if (delSet[id]) return

    const dish = rowToDish(row)
    if (!dish) return

    const at = posOf[id]
    if (at === undefined) {
      out.push(dish)
      posOf[id] = out.length - 1
      added++
      return
    }
    if (out[at][EDITED]) return

    // 只有真变了才算「更新」—— sync() 靠这个数字决定要不要重画列表，
    // 每轮都报「更新了 N 道」会让菜单页每次 onShow 都白重画一遍
    const before = out[at]
    const merged = Object.assign({}, before, dish)
    // 本地标记要保住：dish 里没有这两个字段，被覆盖没了就会「推过的又推一遍」
    if (before[PENDING]) merged[PENDING] = before[PENDING]
    if (before[EDITED]) merged[EDITED] = before[EDITED]
    const dirty = ['name', 'category', 'emoji', 'spice', 'description', 'updated_at']
      .some(function (k) { return before[k] !== merged[k] })
    out[at] = merged
    if (dirty) updated++
  })

  return { override: out, deleted: del, added: added, updated: updated, changed: added > 0 || updated > 0 }
}

// ---------- 网络（失败一律返回 null / false，从不抛错） ----------

/** 拉全部云端增量。菜品是几十条的规模，不做增量游标，一次全拿更简单也更稳。 */
async function listRemote() {
  if (typeof wx === 'undefined' || !wx) return null
  try {
    const res = unwrap(
      await getDB().from(TABLE).select('*').order('created_at', { ascending: true }).range(0, 499)
    )
    return Array.isArray(res.data) ? res.data : []
  } catch (err) {
    return null
  }
}

/** 新增一道菜，返回入库后的行（带云端发的 id）；失败返回 null */
async function pushAdd(dish, byName) {
  if (typeof wx === 'undefined' || !wx) return null
  try {
    const res = unwrap(await getDB().from(TABLE).insert(dishToRow(dish, byName)).select())
    const row = Array.isArray(res.data) && res.data.length ? res.data[0] : null
    // 与订单 / 日志同理：被 RLS 拦下时返回的是空数组而不是错误
    return row && row.id !== undefined ? row : null
  } catch (err) {
    return null
  }
}

/** 改一道云端菜；失败返回 false */
async function pushUpdate(id, dish, byName) {
  if (typeof wx === 'undefined' || !wx) return false
  try {
    const row = dishToRow(dish, byName)
    row.updated_at = new Date().toISOString()
    const res = unwrap(await getDB().from(TABLE).update(row).eq('id', Number(id)).select())
    return Array.isArray(res.data) && res.data.length > 0
  } catch (err) {
    return false
  }
}

/** 删一道云端菜；失败返回 false */
async function pushRemove(id) {
  if (typeof wx === 'undefined' || !wx) return false
  try {
    const res = unwrap(await getDB().from(TABLE).delete().eq('id', Number(id)).select())
    return Array.isArray(res.data) && res.data.length > 0
  } catch (err) {
    return false
  }
}

module.exports = {
  TABLE,
  PENDING,
  EDITED,
  isCloudId,
  rowToDish,
  dishToRow,
  mergeInto,
  listRemote,
  pushAdd,
  pushUpdate,
  pushRemove,
}
