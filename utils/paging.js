// 长列表分页：滚到底再放一页，别一次渲染三百多道菜
//
// 菜品库有 303 道，菜单页与选菜弹层过去都是全量渲染 —— 首屏要建的节点太多，
// 低端机上滚动会发涩。改成「首屏 30 条，滚到底再 +30」。
//
// 抽成纯函数是为了能直接测：页面 / 组件里只剩下「把结果 setData 出去」那一句。
//
// 关键不变式：**渲染出来的列表永远是完整列表的前缀**（slice(0, shown)）。
// 于是 wxml 里 `data-idx="{{index}}"` 的下标与完整列表天然一致 ——
// 页面上原有「按 index 取元素」的写法不会因为分页而错位。

// 一页多少条。首屏渲染 ≤ 40 项（清单 C7 的验收线）就靠它兜住。
const PAGE_SIZE = 30

function toInt(v) {
  const n = Number(v)
  if (isNaN(n)) return 0
  return Math.floor(n)
}

/** 首屏显示多少条：列表比一页短就全显示 */
function initial(total) {
  return Math.min(PAGE_SIZE, Math.max(0, toInt(total)))
}

/** 当前显示的条数是否还没到头（还有更多可以翻） */
function hasMore(shown, total) {
  return toInt(shown) < Math.max(0, toInt(total))
}

/** 再放一页之后的显示条数（封顶在总数，不会越界） */
function grow(shown, total) {
  return Math.min(toInt(shown) + PAGE_SIZE, Math.max(0, toInt(total)))
}

/** 取前 shown 条。shown 是「前缀长度」，不是下标，所以 0 表示一条都不显示 */
function slice(list, shown) {
  return (Array.isArray(list) ? list : []).slice(0, Math.max(0, toInt(shown)))
}

/** 列表变短（筛选 / 删菜 / 重新搜索）后把已显示条数夹回合法区间 */
function clamp(shown, total) {
  return Math.min(Math.max(0, toInt(shown)), Math.max(0, toInt(total)))
}

module.exports = {
  PAGE_SIZE,
  initial,
  hasMore,
  grow,
  slice,
  clamp,
}
