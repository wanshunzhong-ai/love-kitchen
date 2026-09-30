// 忌口清单的收敛与展示（纯函数，页面层与订单服务端共用同一份规则）
//
// 为什么单独开一个文件：
//   忌口是「干饭人自己敲的自由文本」，从输入到落库要过三道手
//   （资料页录入 → 本地存储 → 随订单写进云端）。每处各写一套收敛规则，
//   迟早出现「页面里明明存进去了，服务端当脏数据丢掉了」这种两头对不上的情况。
//   所以规则只在这里定义一次：store 存的时候用它，订单服务端收的时候也用它。
//
// 忌口的两个语义：
//   1. 它是**随订单走的快照**。掌勺人的手机读不到干饭人的本地存储，
//      忌口只有跟着订单一起上云，对方才看得到 —— 跟 items 是同一个道理。
//      下单那一刻的清单冻结在订单里，之后干饭人再改忌口也不会倒回去改历史订单。
//   2. 它是**给人扫一眼的一句话**。掌勺人开火前看一眼就得明白，
//      所以除了数组，这里还负责拼好「香菜、花生」这种可直接渲染的文案。

const { AVOID_MAX, AVOID_TEXT_MAX } = require('./constants')

/** 单条忌口收敛：非字符串一律丢掉；trim 后按 TEXT_MAX 限长 */
function cleanOne(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, AVOID_TEXT_MAX)
}

/**
 * 清单收敛：逐条 trim → 限长 → 去重 → 限量。
 * 永远返回**新数组**，脏数据（数字 / null / 对象 / 空串）静默丢掉，
 * 绝不抛错 —— 它同时跑在页面上和写库路径上，不该因为一条脏数据把下单打断。
 * @param {Array} list
 * @returns {string[]}
 */
function normalize(list) {
  const arr = Array.isArray(list) ? list : []
  const seen = {}
  const out = []
  for (let i = 0; i < arr.length && out.length < AVOID_MAX; i++) {
    const item = cleanOne(arr[i])
    if (item && !seen[item]) {
      seen[item] = true
      out.push(item)
    }
  }
  return out
}

/**
 * 清单 → 一句话：「香菜、花生」。
 * 没有忌口返回 ''（页面据此决定整块要不要渲染，不留空壳）。
 * @param {Array} list
 * @param {string} [sep] 分隔符，默认中文顿号
 */
function textOf(list, sep) {
  const items = normalize(list)
  if (!items.length) return ''
  return items.join(sep === undefined ? '、' : sep)
}

/** 有没有忌口 */
function hasAny(list) {
  return normalize(list).length > 0
}

module.exports = {
  MAX: AVOID_MAX,
  TEXT_MAX: AVOID_TEXT_MAX,
  cleanOne: cleanOne,
  normalize: normalize,
  textOf: textOf,
  hasAny: hasAny,
}
