// 点单截止前的「该动手了」提醒（只给掌勺人）
//
// 规则：一单约了用餐时段，该时段就有个点单截止时刻（见 constants.js 的 DINE_SLOTS，
// 如午餐 14:30）。在截止前 REMIND_BEFORE_MIN 分钟，如果这单**还没开做**（状态仍是
// 待开做），就弹一次窗提醒掌勺人 —— 这是一天里唯一会「主动跳出来」的提示。
//
// 三条刻意的取舍：
//   1) 只在「掌勺人」身份下弹。单子是干饭人下的，但"还没开始做"这件事只有掌勺人能动，
//      提醒下单的人只会让 TA 干着急。
//   2) 状态不是「待开做」的一律不管：正在做 / 已上菜不必催；被驳回的单球已经回到
//      干饭人那边（等 TA 改了重新提交），这时候催掌勺人是催错人。
//   3) 窗口是 [截止 - 30 分钟, 截止)。过了截止就不再提醒 —— 那时候该看的是
//      「哪单超时没做」，而不是再弹一次「快到了」，提醒也来不及了。
//
// 提醒只可能出现在「对方正开着小程序」时：云服务 SDK 没有推送通道，
// 小程序关着收不到任何东西（详见 utils/live.js 顶部说明）。
// 所以这里是被轮询每轮调一次的，而不是自己起定时器。
//
// 去重靠 storage 里的「已提醒」集合（store.markReminded）：一单只提醒一次。
// key 里带了日期与时段 —— 干饭人把用餐时间改掉，就是一件新的事，值得再提醒一次。

const dine = require('./dine')
const store = require('./store')
const ui = require('./ui')

// 截止前多少分钟开始提醒
const REMIND_BEFORE_MIN = 30

// 一份提示里最多列几单（再多了弹窗读不完，剩下的折成一句话）
const MAX_LINES = 4

// ---------------------------------------------------------------------------
// 纯函数部分（不碰 wx，可被 node 直接跑契约测试）
// ---------------------------------------------------------------------------

/** 状态缺省算「待开做」（老数据 / 半截对象兜底） */
function isPending(order) {
  return String((order && order.status) || 'pending') === 'pending'
}

/** 这一单的截止时刻 → 毫秒；没有用餐时间（老订单「尽快」）返回 0 */
function cutoffMs(order) {
  const at = dine.cutoffAt(order && order.dine_date, order && order.dine_slot)
  return at ? at.getTime() : 0
}

/**
 * 距截止还剩几分钟。向上取整（还剩 30 秒也说「还有 1 分钟」），
 * 已过截止返回 0；这单没有截止时刻返回 null。
 */
function minutesLeft(order, now) {
  const end = cutoffMs(order)
  if (!end) return null
  const base = now || new Date()
  return Math.max(0, Math.ceil((end - base.getTime()) / 60000))
}

/**
 * 这一单此刻该不该提醒。
 * 三个条件同时满足：还没开做 + 有截止时刻 + 现在落在截止前 30 分钟内。
 */
function isDue(order, now) {
  if (!order || !isPending(order)) return false
  const end = cutoffMs(order)
  if (!end) return false
  const t = (now || new Date()).getTime()
  return t >= end - REMIND_BEFORE_MIN * 60000 && t < end
}

/**
 * 去重键：订单 id + 用餐日期 + 时段。
 * 刻意不带状态 —— 一单被提醒过就是提醒过了，之后状态怎么变都算同一件事。
 */
function remindKey(order) {
  const id = String((order && (order._id || order.id)) || '')
  return id + '|' + String((order && order.dine_date) || '') + '|' + String((order && order.dine_slot) || '')
}

/**
 * 从订单列表里挑出「此刻该提醒、且还没提醒过」的单，按截止时刻从近到远排。
 * @param {Array} orders
 * @param {Date} [now]
 * @param {function(string):boolean} [isReminded] 传 store.hasReminded
 */
function pickDue(orders, now, isReminded) {
  const skip = typeof isReminded === 'function' ? isReminded : function () {
    return false
  }
  const list = []
  ;(Array.isArray(orders) ? orders : []).forEach(function (o) {
    if (!isDue(o, now)) return
    if (skip(remindKey(o))) return
    list.push(o)
  })
  // 截止最近的排最前：万一一次列不下，先说的是最急的那单
  list.sort(function (a, b) {
    return cutoffMs(a) - cutoffMs(b)
  })
  return list
}

function slotTextOf(order) {
  const slot = dine.findSlot(order && order.dine_slot)
  return slot ? slot.text : '这顿饭'
}

function endTextOf(order) {
  return dine.slotEndText(dine.findSlot(order && order.dine_slot))
}

/** 一单有几道菜（按份数算），用于文案里的「· 3 道菜」；0 就不显示 */
function dishQty(order) {
  const items = (order && Array.isArray(order.items) && order.items) || []
  let n = 0
  items.forEach(function (it) {
    n += Number(it && it.qty) || 1
  })
  return n
}

function whoOf(order) {
  return String((order && order.order_by) || 'TA')
}

/**
 * 弹窗文案。list 已按紧急度排好。
 * @returns {{title:string, content:string, confirmText:string, cancelText:string}|null}
 */
function buildMessage(orders, now) {
  const list = Array.isArray(orders) ? orders : []
  if (!list.length) return null

  const base = now || new Date()
  const buttons = { confirmText: '这就去做', cancelText: '知道了' }

  if (list.length === 1) {
    const o = list[0]
    const left = minutesLeft(o, base)
    const n = dishQty(o)
    return {
      title: '⏰ 还有 ' + left + ' 分钟',
      content:
        whoOf(o) + '的' + slotTextOf(o) + ' ' + endTextOf(o) + ' 截止，还没开做' +
        (n ? ' · ' + n + ' 道菜' : ''),
      confirmText: buttons.confirmText,
      cancelText: buttons.cancelText,
    }
  }

  const lines = list.slice(0, MAX_LINES).map(function (o) {
    return '· ' + whoOf(o) + '的' + slotTextOf(o) + ' ' + endTextOf(o) + ' 截止（还有 ' + minutesLeft(o, base) + ' 分钟）'
  })
  if (list.length > MAX_LINES) lines.push('· 还有 ' + (list.length - MAX_LINES) + ' 单…')
  return {
    title: '⏰ 有 ' + list.length + ' 单快到点了',
    content: lines.join('\n') + '\n都还没开做',
    confirmText: buttons.confirmText,
    cancelText: buttons.cancelText,
  }
}

// ---------------------------------------------------------------------------
// 编排（读身份、去重、弹窗）—— 由 app.js 的轮询每轮调一次
// ---------------------------------------------------------------------------

// 弹窗是异步的，而轮询每 15~60 秒就来一轮：不挡住的话，
// 用户还没点掉就又被弹一次。这个标志只防「同时弹两个」。
let showing = false

/**
 * 检查一轮订单，该提醒就弹一次。
 * @param {Array} orders 最新订单列表（live 每轮给的那份）
 * @param {Date} [now]
 * @returns {Promise<boolean>} 这次有没有真的弹了
 */
async function check(orders, now) {
  if (showing) return false
  // 只有掌勺人才看得到这个提醒
  if (store.getRole() !== 'cook') return false

  const due = pickDue(orders, now, store.hasReminded)
  if (!due.length) return false

  const msg = buildMessage(due, now)
  if (!msg) return false

  // 先记「已提醒」再弹：否则弹窗还没点掉，下一轮就会把这几单当成「又该提醒了」
  due.forEach(function (o) {
    store.markReminded(remindKey(o))
  })

  showing = true
  try {
    ui.haptic('heavy')
    const go = await ui.alert({
      title: msg.title,
      content: msg.content,
      confirmText: msg.confirmText,
      cancelText: msg.cancelText,
    })
    // 点「这就去做」→ 直接落到待做看板；点「知道了」就安静收起来
    if (go && typeof wx !== 'undefined' && typeof wx.switchTab === 'function') {
      wx.switchTab({ url: '/pages/todo/todo' })
    }
    return go
  } catch (err) {
    // 弹窗本身失败不该影响轮询
    console.warn('[deadline] 提醒弹窗没能显示：' + ((err && err.message) || err))
    return false
  } finally {
    showing = false
  }
}

module.exports = {
  REMIND_BEFORE_MIN,
  MAX_LINES,
  isPending: isPending,
  cutoffMs: cutoffMs,
  minutesLeft: minutesLeft,
  isDue: isDue,
  remindKey: remindKey,
  pickDue: pickDue,
  buildMessage: buildMessage,
  check: check,
}
