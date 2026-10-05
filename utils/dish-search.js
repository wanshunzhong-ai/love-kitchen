// 菜单搜索 / 分类过滤的**唯一定义**。
//
// 三处要用同一套规则，各写一份必然漂移（历史上 test_menu_search.js 就是
// 复刻了一份算法在测，测的是副本、不是真东西）：
//   1. pages/menu —— 菜单页的搜索框
//   2. components/dish-picker —— 加菜 / 换菜弹层的搜索框
//   3. 任何「按分类 + 关键词挑菜」的地方
//
// 匹配口径：**菜名 / 介绍 / 分类** 三者任一命中即算；关键词按空白分隔，
// 多个词必须全部命中（「鸡 汤」= 既含鸡又含汤）。
// 分类是精确相等（不是模糊包含）—— 选中「米粉主食」就该只有那 37 道。
//
// 纯本地模块，零依赖、零副作用（可以放心被页面与组件引用）。

/** 分类筛选里的「全部」哨兵值。menu 页与弹层都用这个词，别各写各的。 */
const ALL = '全部'

/**
 * 搜索输入的防抖窗口（毫秒）。
 * 三百多道菜，每敲一个字都全量过滤 + 整列表 setData 不划算，
 * 叠上掌勺人的频率排序还要每字符 sort 一次。200ms 是「打字手感」与
 * 「少算几次」的折中：正常语速连打一个字间隔都小于它，一串输入只会过滤一次。
 */
const DEBOUNCE = 200

/**
 * 生成（并缓存）一个小写检索串。
 * 预生成是为了避免每次输入都重复 toLowerCase —— 三百多道菜 × 每个字符。
 * 缓存挂在对象自己的 `_hay` 上；对象被 Object.assign 复制时缓存跟着走，
 * 丢了也只是重算一次，不影响正确性。
 * @param {Object} dish
 * @returns {string} 小写检索串
 */
function hay(dish) {
  const d = dish || {}
  if (typeof d._hay === 'string') return d._hay
  const s = ((d.name || '') + ' ' + (d.description || '') + ' ' + (d.category || '')).toLowerCase()
  try {
    d._hay = s
  } catch (err) {
    // 冻结对象之类的情况：不缓存，照常返回
  }
  return s
}

/**
 * 关键词 → 小写词元数组。空串 / 纯空格 / null 都得到空数组（= 不过滤）。
 * @param {string} keyword
 * @returns {Array<string>}
 */
function keywords(keyword) {
  return String(keyword === null || keyword === undefined ? '' : keyword)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(function (p) {
      return p
    })
}

/**
 * 按分类筛。category 为空或「全部」时原样返回。
 * @param {Array} list
 * @param {string} category
 * @returns {Array}
 */
function byCategory(list, category) {
  const arr = Array.isArray(list) ? list : []
  if (!category || category === ALL) return arr
  return arr.filter(function (d) {
    return d && d.category === category
  })
}

/**
 * 分类 + 关键词一起筛（关键词为空则只按分类）。
 * 返回新数组，不改原数组。
 * @param {Array} list
 * @param {string} category
 * @param {string} keyword
 * @returns {Array}
 */
function filterBy(list, category, keyword) {
  const parts = keywords(keyword)
  return byCategory(list, category).filter(function (d) {
    if (!parts.length) return true
    const h = hay(d)
    return parts.every(function (p) {
      return h.indexOf(p) >= 0
    })
  })
}

module.exports = { ALL, DEBOUNCE, hay, keywords, byCategory, filterBy }
