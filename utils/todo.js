// 待做看板的数据整理（纯函数，页面只负责 setData 与交互）
//
// 给掌勺人看的是「今天这一天的三餐」：
//   早餐 / 午餐 / 晚餐 / 夜宵 四格按 DINE_SLOTS 顺序排好，
//   没填时段、没填日期、日期已过的单子统一进「尽快要做」格（排最前），
//   已上菜（done）的不在待做范围；未来日期的只汇总成摘要（点一下去订单页看全部）。
//
// 所有函数都接受 todayKey 参数（'YYYY-MM-DD'），方便测试注入固定日期。

const dine = require('./dine')
const { SPICE_LEVELS, DINE_SLOTS } = require('./constants')

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 兜底格：老订单没填时段 / 没填日期，或日期已过（逾期该补做的）
const ASAP = { key: '_asap', text: '尽快要做', emoji: '⏰' }

// 日期 key → 「今天 9/29」「明天 9/30」「周三 10/1」；解析不了就原样返回
function dateLabel(dateKey) {
  try {
    const d = new Date(dateKey + 'T00:00:00')
    if (!isNaN(d.getTime())) {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
      const label = diff === 0 ? '今天' : diff === 1 ? '明天' : WEEK_LABELS[d.getDay()]
      return label + ' ' + (d.getMonth() + 1) + '/' + d.getDate()
    }
  } catch (e) {
    // 保底用原始字符串
  }
  return dateKey
}

// 订单 → 卡片数据：id 兜底 + 辣度档位 + rowKey（同名菜不同辣度要能区分）
function toCard(o) {
  const items = (Array.isArray(o.items) ? o.items : []).map(function (it) {
    const spice = it.spice || '不辣'
    const hit = SPICE_LEVELS.find(function (s) {
      return s.key === spice
    })
    const level = hit ? hit.level : 0
    return Object.assign({}, it, {
      rowKey: String(it.name) + '|' + spice,
      spice: spice,
      spiceIdx: level,
      spiceText: level > 0 ? '🌶️'.repeat(level) : '不辣',
    })
  })
  return Object.assign({}, o, {
    id: o._id || o.id,
    items: items,
    // 「尽快要做」格里单子来自哪一天要说清楚，其余格子由格头承担时段文案
    dineText: dine.formatDine(o.dine_date, o.dine_slot),
  })
}

// 一格的打包：格头信息 + 单数 / 菜数统计
function packMeal(meta, orders, showDine) {
  const dishCount = orders.reduce(function (sum, o) {
    return (
      sum +
      o.items.reduce(function (s, it) {
        return s + (it.qty || 0)
      }, 0)
    )
  }, 0)
  return {
    key: meta.key,
    emoji: meta.emoji,
    text: meta.text,
    showDine: !!showDine,
    orders: orders,
    orderCount: orders.length,
    dishCount: dishCount,
  }
}

/**
 * 把云端订单整理成看板数据
 * @param {Array} orders listOrders 返回的订单
 * @param {string} todayKey 今天 'YYYY-MM-DD'
 * @returns {{ meals: Array, todayCount: number, todayDishes: number,
 *            laterGroups: Array, laterDishes: number, isEmpty: boolean }}
 */
function buildBoard(orders, todayKey) {
  const bySlot = {}
  DINE_SLOTS.forEach(function (s) {
    bySlot[s.key] = []
  })
  const asap = []
  const later = {}

  ;(Array.isArray(orders) ? orders : []).forEach(function (o) {
    if (!o || o.status === 'done') return // 已上菜的不在待做范围
    const card = toCard(o)
    const date = card.dine_date || ''

    if (date && date > todayKey) {
      // 未来的单子：只留摘要，不铺开菜品（看全部去订单页）
      if (!later[date]) later[date] = []
      later[date].push(card)
      return
    }
    // 今天的单子按用餐时段入格
    if (date === todayKey && card.dine_slot && bySlot[card.dine_slot]) {
      bySlot[card.dine_slot].push(card)
      return
    }
    // 没填时段 / 没填日期 / 日期已过 → 尽快做
    asap.push(card)
  })

  const meals = DINE_SLOTS.map(function (s) {
    return packMeal({ key: s.key, text: s.text, emoji: s.emoji }, bySlot[s.key], false)
  })
  if (asap.length) meals.unshift(packMeal(ASAP, asap, true))

  const laterGroups = Object.keys(later)
    .sort()
    .map(function (key) {
      return packMeal({ key: key, text: dateLabel(key), emoji: '📅' }, later[key], false)
    })

  const todayCount = meals.reduce(function (sum, m) {
    return sum + m.orderCount
  }, 0)
  const todayDishes = meals.reduce(function (sum, m) {
    return sum + m.dishCount
  }, 0)
  const laterDishes = laterGroups.reduce(function (sum, g) {
    return sum + g.dishCount
  }, 0)

  return {
    meals: meals,
    todayCount: todayCount,
    todayDishes: todayDishes,
    laterGroups: laterGroups,
    laterDishes: laterDishes,
    isEmpty: todayCount === 0 && laterGroups.length === 0,
  }
}

/** 顶部一句话概览 */
function heroSub(board) {
  const laterDays = board.laterGroups.length
  if (board.todayDishes > 0) {
    return (
      '今天还有 ' + board.todayDishes + ' 道菜要做' +
      (laterDays > 0 ? ' · 后面 ' + laterDays + ' 天还有单' : '')
    )
  }
  if (laterDays > 0) {
    return '今天没有要做的 · 后面 ' + laterDays + ' 天还有 ' + board.laterDishes + ' 道菜'
  }
  return '今天没有要做的菜，歇会儿吧 ☕'
}

module.exports = {
  buildBoard: buildBoard,
  heroSub: heroSub,
  dateLabel: dateLabel,
  ASAP: ASAP,
}
