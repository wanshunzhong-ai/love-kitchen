// 菜品评价（干饭人给掌勺人的手艺打分）
//
// 规则：
//   · 只有「已上菜」（status === 'done'）的订单可以评，一道菜一条；
//   · 评价的粒度是「订单里的一行」—— 同一道菜的不同辣度算两条，各评各的，
//     与购物车 / 编辑订单页的 itemKey 规则完全一致（dishId|辣度）；
//   · 一条评价 = 星级（1~5，必填）+ 快捷标签（可多选，最多 3 个）+ 一句话（可空）。
//
// 存储形态（数据库 orders.reviews，jsonb）：
//   { "12|微辣": { rating: 5, tags: ["好吃"], text: "太香了", by: "宝贝", at: "2026-09-29T07:30:00.000Z" } }
// 用「对象按键查找」而不是数组：天然保证同一道菜不会被写出两条评价，读取也是 O(1)。
//
// 本文件全是纯函数（不碰 wx / 不碰网络），因此可以被 node 直接跑契约测试。

// 星级范围
const RATING_MAX = 5

// 一句话评价的字数上限
const REVIEW_TEXT_MAX = 40

// 每条评价最多挂几个快捷标签
const REVIEW_TAGS_MAX = 3

// 星级 → 文案（未评分的 0 分不出现，由页面显示「还没评价」）
const RATING_LABELS = {
  1: '不太行',
  2: '一般般',
  3: '还不错',
  4: '好吃',
  5: '太好吃了',
}

// 快捷标签：点一下就挂上，省得逐字打；既有夸也有挑，方便说真话
const REVIEW_TAGS = [
  { emoji: '😋', text: '好吃' },
  { emoji: '🍚', text: '超下饭' },
  { emoji: '🔥', text: '火候刚好' },
  { emoji: '🌶️', text: '辣度刚好' },
  { emoji: '🧂', text: '有点咸' },
  { emoji: '💧', text: '淡了点' },
  { emoji: '🫗', text: '油有点大' },
  { emoji: '🥰', text: '还想再吃' },
]

// 星级格子的渲染数组，wxml 里 wx:for 用它画 5 颗星
const STAR_SLOTS = [1, 2, 3, 4, 5]

/**
 * 订单内某一行的评价键。
 * 必须与 pages/order-edit 的 itemKey 保持一致 —— 规则不一致会导致
 * 「编辑页按 A 存、评价页按 B 读」，评价就凭空消失。
 * @param {{dishId?:*, name?:string, spice?:string}} it 订单里的菜品行
 * @returns {string}
 */
function itemKey(it) {
  const id = it && it.dishId !== null && it.dishId !== undefined ? it.dishId : it && it.name
  return String(id === null || id === undefined ? '' : id) + '|' + ((it && it.spice) || '不辣')
}

// 星级收敛：非数字 / 越界一律当 0（= 还没评），保证入库干净
function normalizeRating(v) {
  const n = Math.round(Number(v))
  if (!isFinite(n) || n <= 0) return 0
  return n > RATING_MAX ? RATING_MAX : n
}

// 标签收敛：只要字符串、去掉空与重复、最多 REVIEW_TAGS_MAX 个
function normalizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : []
  const seen = {}
  const out = []
  for (let i = 0; i < arr.length && out.length < REVIEW_TAGS_MAX; i++) {
    const t = String(arr[i] === null || arr[i] === undefined ? '' : arr[i]).trim()
    if (t && !seen[t]) {
      seen[t] = true
      out.push(t)
    }
  }
  return out
}

// 一句话收敛：去首尾空白 + 限长
function normalizeText(raw) {
  return String(raw === null || raw === undefined ? '' : raw).trim().slice(0, REVIEW_TEXT_MAX)
}

/**
 * 数据库取回的 reviews → 规范的对象。脏数据（数组 / 字符串 / null）一律当空，
 * 避免老数据或半截写入把页面打崩。
 * @returns {Object<string, object>}
 */
function normalizeReviews(raw) {
  let src = raw
  if (typeof src === 'string') {
    try {
      src = JSON.parse(src)
    } catch (e) {
      return {}
    }
  }
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {}

  const out = {}
  Object.keys(src).forEach(function (key) {
    const r = src[key]
    if (!r || typeof r !== 'object') return
    const rating = normalizeRating(r.rating)
    if (rating <= 0) return // 没有星级等于没评，直接丢掉
    out[key] = {
      rating: rating,
      tags: normalizeTags(r.tags),
      text: normalizeText(r.text),
      by: String(r.by || ''),
      at: String(r.at || ''),
    }
  })
  return out
}

/** 取某一道菜的评价；没评过返回 null */
function reviewOf(reviews, key) {
  const all = normalizeReviews(reviews)
  return all[key] || null
}

/**
 * 写入 / 覆盖某一道菜的评价（返回新对象，不改入参）。
 * @param {object} reviews 现有评价表
 * @param {string} key 菜品行键
 * @param {{rating:number, tags?:Array, text?:string, by?:string, at?:string}} patch
 * @returns {object} 新的评价表；评分为 0 时等于「删掉这一条」
 */
function putReview(reviews, key, patch) {
  const all = Object.assign({}, normalizeReviews(reviews))
  const p = patch || {}
  const rating = normalizeRating(p.rating)
  if (!key || rating <= 0) {
    delete all[key]
    return all
  }
  const prev = all[key] || {}
  all[key] = {
    rating: rating,
    tags: p.tags === undefined ? normalizeTags(prev.tags) : normalizeTags(p.tags),
    text: p.text === undefined ? normalizeText(prev.text) : normalizeText(p.text),
    by: p.by === undefined ? String(prev.by || '') : String(p.by || ''),
    at: p.at === undefined ? String(prev.at || '') : String(p.at || ''),
  }
  return all
}

/** 删掉某一道菜的评价（返回新对象） */
function dropReview(reviews, key) {
  const all = Object.assign({}, normalizeReviews(reviews))
  delete all[key]
  return all
}

/** 星级文案；0 分返回「还没评价」 */
function ratingLabel(rating) {
  return RATING_LABELS[normalizeRating(rating)] || '还没评价'
}

/**
 * 把订单里的菜品行与评价拼在一起，供页面直接渲染。
 * 每行新增：key / review（null 或对象）/ stars（用于画星）/ ratingLabel
 * @param {Array} items 订单菜品清单
 * @param {object} reviews 评价表
 * @returns {Array}
 */
function decorateItems(items, reviews) {
  const all = normalizeReviews(reviews)
  return (Array.isArray(items) ? items : []).map(function (it) {
    const key = itemKey(it)
    const review = all[key] || null
    const spice = (it && it.spice) || '不辣'
    return Object.assign({}, it, {
      key: key,
      spice: spice,
      qty: Number(it && it.qty) || 1,
      review: review,
      rated: !!review,
      ratingLabel: review ? ratingLabel(review.rating) : '',
      hasReview: !!(review && (review.text || review.tags.length)),
    })
  })
}

/**
 * 评价进度汇总：已评几道 / 共几道 / 平均分 / 是否都评完了。
 * 平均分只按「已评的菜」计算，没评的不算 0 分拉低——否则刚评完一道
 * 就看到「平均 1.5 分」，纯属吓人。
 * @returns {{ total:number, rated:number, avg:number, avgText:string, allDone:boolean, any:boolean }}
 */
function summarize(items, reviews) {
  const all = normalizeReviews(reviews)
  const list = Array.isArray(items) ? items : []
  let rated = 0
  let sum = 0
  list.forEach(function (it) {
    const r = all[itemKey(it)]
    if (r) {
      rated += 1
      sum += r.rating
    }
  })
  const avg = rated ? sum / rated : 0
  return {
    total: list.length,
    rated: rated,
    avg: avg,
    // 保留一位小数，页面直接用
    avgText: rated ? (Math.round(avg * 10) / 10).toFixed(1) : '',
    allDone: list.length > 0 && rated === list.length,
    any: rated > 0,
  }
}

/**
 * 判断这一单此刻能不能评。
 * 三重条件缺一不可：状态已上菜 + 身份是干饭人 + 订单存在。
 * 掌勺人看到的是「TA 的评价」只读展示，入口不给。
 * @param {object} order 订单
 * @param {string} role 身份 key
 * @returns {boolean}
 */
function canReview(order, role) {
  if (!order || !order.id) return false
  if (role !== 'orderer') return false
  return order.status === 'done'
}

module.exports = {
  RATING_MAX,
  REVIEW_TEXT_MAX,
  REVIEW_TAGS_MAX,
  RATING_LABELS,
  REVIEW_TAGS,
  STAR_SLOTS,
  itemKey,
  normalizeRating,
  normalizeTags,
  normalizeText,
  normalizeReviews,
  reviewOf,
  putReview,
  dropReview,
  ratingLabel,
  decorateItems,
  summarize,
  canReview,
}
