// 驳回：掌勺人拒绝做这一单，但必须说清楚为什么
//
// 为什么驳回要单独成一条规则、而不是当成第四个状态选项：
//   1) 驳回必须带理由 —— 干饭人看到的是「为什么不做」，而不是一个冷冰冰的状态；
//   2) 能驳回的状态和能「推进」的状态不一样（开做了也能驳回：食材不够是常事），
//      把这条判定收在一处，页面层与服务端引同一份，不会各写一套后漂移。
//
// 本文件是纯函数（不碰 wx），页面层 / utils/orders.js / 测试都引它。
const { REJECT_MAX } = require('./constants')

// 允许驳回的状态：待开做 + 开做中。
// 已上菜（done）不能驳回（菜都端上桌了），已驳回（rejected）也不用再驳一次。
const REJECTABLE = ['pending', 'cooking']

// 驳回的快捷说法：手机上一键选，省得逐字打。
// 想写别的就选「自己写一句」。
const QUICK_REASONS = [
  '食材不够啦',
  '今天来不及做',
  '换个别的吃吧',
  '这道菜太难啦',
  '今天想吃的太多啦',
]

/** 这个状态能不能驳回 */
function canReject(status) {
  return REJECTABLE.indexOf(String(status || 'pending')) >= 0
}

/**
 * 理由收敛：只接受字符串（脏数据一律当没写，与逐道菜备注同一套口径）、
 * 去首尾空白、按上限截断。
 * @returns {string} 干净的理由；空白输入返回空串（调用方据此拦截）
 */
function normalizeReason(v) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, REJECT_MAX)
}

/** 理由是否可用（非空即合法） */
function hasReason(v) {
  return normalizeReason(v).length > 0
}

/**
 * 提示条上只显示一小段，把长理由压成一行。
 * @param {string} reason
 * @param {number} [max] 保留的字数，超出用「…」收尾
 */
function shortReason(reason, max) {
  const text = normalizeReason(reason)
  const n = Number(max) > 0 ? Number(max) : 12
  return text.length > n ? text.slice(0, n) + '…' : text
}

module.exports = {
  REJECTABLE,
  QUICK_REASONS,
  canReject,
  normalizeReason,
  hasReason,
  shortReason,
}
