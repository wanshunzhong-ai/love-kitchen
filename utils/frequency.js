// 点菜频率：从历史订单里数出「哪道菜被 TA 点过几次」。
//
// 用途：掌勺人的菜单页按频率排序 —— 常点的排前面，
// 三百多道菜里一眼就知道该盯着哪几道备料。
//
// 三条刻意的规则（改之前先想清楚）：
//   1. **被驳回的订单不算** —— 那顿没做成，算进去「点得多」就变味了；
//   2. **一行算一次**，数量单独记 —— 「点过 5 次」说的是 5 单里有这道菜，
//      不是 5 份（一份 3 个的那行只算 1 次，份数记在 orderQty 里）；
//   3. **同一道菜可能有两种键** —— 老订单的 items 里只有菜名（没有 dishId），
//      所以 id 与菜名两套键都要查，命中哪个算哪个，两个都命中就相加。
//
// 本文件是纯函数（不碰 wx），可被 node 直接跑契约测试。

const { STATUS } = require('./constants')

/** 计入频率的订单状态；rejected 被排除（见文件头第 1 条） */
const COUNT_STATUSES = [STATUS.pending, STATUS.cooking, STATUS.done]

/** 显示「🔥 常点」标签的最低次数 —— 点过 1 次的菜标出来太吵 */
const HOT_MIN = 2

/** 统计范围：与 listOrders 的取单上限一致（最近 MAX_ORDERS 单） */
const MAX_ORDERS = 200

/** 菜名归一：去空白 + 小写（同名不同写法算同一道菜） */
function nameKey(name) {
  return String(name === null || name === undefined ? '' : name)
    .trim()
    .toLowerCase()
}

/**
 * 订单行 → 统计键。
 * 优先用 dishId（改过名的菜也能对上），没有才退回菜名。
 * @returns {string} 'id:12' / 'name:红烧肉'；两者都没有时返回空串（调用方跳过）
 */
function itemKey(item) {
  const id = item && item.dishId
  if (id !== undefined && id !== null && String(id) !== '') return 'id:' + String(id)
  const n = nameKey(item && item.name)
  return n ? 'name:' + n : ''
}

/** 这一单要不要计入 */
function isCounted(order) {
  if (!order) return false
  return COUNT_STATUSES.indexOf(order.status || STATUS.pending) >= 0
}

/**
 * 数频率。
 * @param {Array} orders 订单列表（utils/orders.js 的 rowToOrder 形状）
 * @returns {Object} { 'id:12': { times, qty }, ... }
 */
function count(orders) {
  const map = {}
  ;(Array.isArray(orders) ? orders : []).forEach(function (o) {
    if (!isCounted(o)) return
    const items = Array.isArray(o.items) ? o.items : []
    items.forEach(function (it) {
      if (!it) return
      const k = itemKey(it)
      if (!k) return
      const row = map[k] || (map[k] = { times: 0, qty: 0 })
      row.times += 1
      const q = Number(it.qty)
      row.qty += q > 0 ? q : 1
    })
  })
  return map
}

/** 取某道菜的次数 / 份数（两套键都查） */
function statOf(map, dish) {
  const empty = { times: 0, qty: 0 }
  if (!map || !dish) return empty
  const byId = map['id:' + String(dish.id)]
  const byName = map['name:' + nameKey(dish.name)]
  const times = (byId ? byId.times : 0) + (byName ? byName.times : 0)
  if (!times) return empty
  return { times: times, qty: (byId ? byId.qty : 0) + (byName ? byName.qty : 0) }
}

/**
 * 把频率挂到菜单上（**保持原顺序**，排序交给 sortByFrequency）。
 * 之所以不在这一步就排好：页面可能想让用户切回默认顺序，
 * 那时只需按 _seq 排回去，不用重新拉数据。
 * @param {Array} dishes 菜单
 * @param {Object} map count() 的结果
 * @returns {Array} 新的数组（每项多出 orderTimes / orderQty / hot / _seq）
 */
function attach(dishes, map) {
  return (Array.isArray(dishes) ? dishes : []).map(function (d, i) {
    const st = statOf(map, d)
    return Object.assign({}, d, {
      orderTimes: st.times,
      orderQty: st.qty,
      hot: st.times >= HOT_MIN,
      // 原始位次：排序的兜底，保证「都没点过」时还是原来那份菜单
      _seq: i,
    })
  })
}

/**
 * 按频率排序：次数多的在前，次数相同看份数，再相同按菜单原顺序。
 * @param {Array} list attach() 产出的列表（或其筛选子集）
 * @returns {Array} 新数组，不改原数组
 */
function sortByFrequency(list) {
  return (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
    const ta = a && a.orderTimes ? a.orderTimes : 0
    const tb = b && b.orderTimes ? b.orderTimes : 0
    if (tb !== ta) return tb - ta
    const qa = a && a.orderQty ? a.orderQty : 0
    const qb = b && b.orderQty ? b.orderQty : 0
    if (qb !== qa) return qb - qa
    return (a && a._seq ? a._seq : 0) - (b && b._seq ? b._seq : 0)
  })
}

/** 菜单里有几道菜被点过（给提示语用） */
function pickedCount(dishes) {
  let n = 0
  ;(Array.isArray(dishes) ? dishes : []).forEach(function (d) {
    if (d && d.orderTimes > 0) n += 1
  })
  return n
}

/** 这道菜点过几次的文案（0 次返回空串，模板直接 wx:if 判空） */
function timesText(times) {
  const n = Number(times) || 0
  return n > 0 ? '点过 ' + n + ' 次' : ''
}

/**
 * 频率签名：用来判断「这一轮订单有没有真的改变统计结果」。
 * 没有变化就不重排、不 setData —— 轮询每 15 秒来一轮，
 * 每次都整表重排会让掌勺人正在看的列表自己乱跳。
 */
function signature(map) {
  const keys = Object.keys(map || {}).sort()
  return keys
    .map(function (k) {
      return k + '=' + map[k].times + '/' + map[k].qty
    })
    .join(',')
}

module.exports = {
  COUNT_STATUSES,
  HOT_MIN,
  MAX_ORDERS,
  nameKey,
  itemKey,
  isCounted,
  count,
  statOf,
  attach,
  sortByFrequency,
  pickedCount,
  timesText,
  signature,
}
