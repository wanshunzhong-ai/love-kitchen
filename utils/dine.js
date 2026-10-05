// 用餐时间：日期 + 时段的纯函数工具（checkout / order-edit / orders / deadline 共用）
//
// 日期范围：今天（含）～ 今天 + DINE_MAX_AHEAD_DAYS（最多提前一周预定）。
// 时段：早 / 中 / 晚 / 夜宵（DINE_SLOTS）。今天的时段过了截止时刻就不可再订，
//       明天起全部可选。
//
// 截止时刻是分钟精度的（如午餐 14:30），所以「几点几分」的比较统一收敛到
// slotsEndMinutes / nowMinutes 这两个函数里 —— 别在别处再写一遍 hour*60+min。
//
// 所有函数都接受 now 参数（默认当前时间），方便测试注入固定时间。
// 时间一律用本地时区——点菜的人和做饭的人在同一座城市，语义最直观。

const { DINE_SLOTS, DINE_MAX_AHEAD_DAYS } = require('./constants')

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

// 按时段 key 找定义；找不到返回 null
function findSlot(key) {
  if (!key) return null
  for (let i = 0; i < DINE_SLOTS.length; i++) {
    if (DINE_SLOTS[i].key === key) return DINE_SLOTS[i]
  }
  return null
}

// 时段的截止时刻换算成「当天第几分钟」（10:00 → 600，14:30 → 870）。
// 不合法返回 null，调用方据此跳过。
function slotEndMinutes(slot) {
  if (!slot) return null
  const h = Number(slot.endHour)
  const m = Number(slot.endMinute)
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

// 截止时刻文案 'HH:MM'（给弹窗与界面提示用）
function slotEndText(slot) {
  const min = slotEndMinutes(slot)
  if (min === null) return ''
  return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60)
}

// 某时刻换算成「当天第几分钟」
function nowMinutes(now) {
  const base = now || new Date()
  return base.getHours() * 60 + base.getMinutes()
}

// Date → 'YYYY-MM-DD'（本地时区，不用 toISOString 以免被 UTC 挪走一天）
function toDateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

// 仅把「锚点」的时间部分清零，用于做天数差
function startOfDay(d) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return out
}

// 今天是不是四个时段都已经过了截止时刻（23:30 之后到零点这半小时会出现）。
// 这时「今天」不能再选 —— 否则会订出一单「今天的早餐」，永远做不出来。
function todayAllClosed(now) {
  const min = nowMinutes(now)
  return DINE_SLOTS.every(function (s) {
    const end = slotEndMinutes(s)
    return end === null || min >= end
  })
}

// 从今天（含）起、共 1 + DINE_MAX_AHEAD_DAYS 天的日期选项
// label：今天 / 明天 / 周X；sub：M/D；value：'YYYY-MM-DD'；disabled：今天且已全关
function buildDateOptions(now) {
  const base = now || new Date()
  const closed = todayAllClosed(base)
  const options = []
  for (let offset = 0; offset <= DINE_MAX_AHEAD_DAYS; offset++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
    const label = offset === 0 ? '今天' : offset === 1 ? '明天' : WEEK_LABELS[d.getDay()]
    options.push({
      value: toDateKey(d),
      label: label,
      sub: d.getMonth() + 1 + '/' + d.getDate(),
      weekday: WEEK_LABELS[d.getDay()],
      // 只有「今天 + 四个时段全过」才禁；明天起永远可选
      disabled: offset === 0 && closed,
    })
  }
  return options
}

// 默认日期：第一个还可订的日子（23:30 之后打开就是明天）
function defaultDate(now) {
  const options = buildDateOptions(now)
  for (let i = 0; i < options.length; i++) {
    if (!options[i].disabled) return options[i].value
  }
  return options[options.length - 1].value
}

// 指定日期 + 当前时间下，可订的时段（今天的已过时段 disabled）
function buildSlotOptions(now, dateValue) {
  const base = now || new Date()
  const isToday = dateValue === toDateKey(base)
  const min = nowMinutes(base)
  return DINE_SLOTS.map(function (slot) {
    const end = slotEndMinutes(slot)
    return {
      key: slot.key,
      text: slot.text,
      emoji: slot.emoji,
      endText: slotEndText(slot),
      // 只有「今天 + 已到/过了截止时刻」才禁用（分钟精度：14:29 还能订，14:30 就不能）
      disabled: isToday && end !== null && min >= end,
    }
  })
}

// 默认时段：今天第一个还可订的；全过时（深夜订明早）取第一个
function defaultSlot(now, dateValue) {
  const slots = buildSlotOptions(now, dateValue || toDateKey(now || new Date()))
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i].disabled) return slots[i].key
  }
  return slots.length ? slots[0].key : 'dinner'
}

// 校验（orders.js 写库前调用）。合法返回 null，否则返回给用户看的错误文案。
function validate(dineDate, dineSlot, now) {
  const base = now || new Date()

  if (dineSlot !== undefined && dineSlot !== null && dineSlot !== '') {
    const hit = DINE_SLOTS.some(function (s) {
      return s.key === dineSlot
    })
    if (!hit) return '用餐时段不合法'
  } else if (dineSlot === undefined) {
    // 未传：createOrder 场景允许（老接口兼容）；这里只挡「显式传了非法值」
  }

  if (dineDate !== undefined && dineDate !== null && dineDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dineDate)) return '用餐日期格式不对'
    const day = startOfDay(new Date(dineDate + 'T00:00:00'))
    // JS 会把 2 月 30 日自动进位成 3 月 2 日：解析结果回写比对才能抓出「不存在的日期」
    if (isNaN(day.getTime()) || toDateKey(day) !== dineDate) return '用餐日期不存在'
    const today = startOfDay(base)
    const last = new Date(today.getTime())
    last.setDate(last.getDate() + DINE_MAX_AHEAD_DAYS)
    if (day.getTime() < today.getTime()) return '用餐日期不能早于今天'
    if (day.getTime() > last.getTime()) return '最多只能提前一周预定'
  }

  return null
}

// 展示文案：'周三 9/30 · 午餐'。日期为空 → '尽快'（老订单兜底）。
function formatDine(dineDate, dineSlot) {
  if (!dineDate) return '尽快'
  let dateText = dineDate
  try {
    const d = new Date(dineDate + 'T00:00:00')
    if (!isNaN(d.getTime())) {
      const today = startOfDay(new Date())
      const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000)
      const label = diff === 0 ? '今天' : diff === 1 ? '明天' : WEEK_LABELS[d.getDay()]
      dateText = label + ' ' + (d.getMonth() + 1) + '/' + d.getDate()
    }
  } catch (e) {
    // 保底用原始字符串
  }
  const slot = findSlot(dineSlot)
  return slot ? dateText + ' · ' + slot.text : dateText
}

// 某一单的「点单截止时刻」→ Date（本地时区）。
// 缺日期 / 缺时段 / 时段不合法 → null。
// 老订单没填用餐时间（展示为「尽快」）时就没有截止时刻，也就没有到点提醒 ——
// 这是有意的：没约好时间的事，不该按别人的钟点去催。
function cutoffAt(dineDate, dineSlot) {
  if (!dineDate || !/^\d{4}-\d{2}-\d{2}$/.test(dineDate)) return null
  const end = slotEndMinutes(findSlot(dineSlot))
  if (end === null) return null
  const d = new Date(dineDate + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  d.setHours(Math.floor(end / 60), end % 60, 0, 0)
  return d
}

module.exports = {
  buildDateOptions: buildDateOptions,
  buildSlotOptions: buildSlotOptions,
  defaultDate: defaultDate,
  defaultSlot: defaultSlot,
  todayAllClosed: todayAllClosed,
  findSlot: findSlot,
  slotEndMinutes: slotEndMinutes,
  slotEndText: slotEndText,
  cutoffAt: cutoffAt,
  validate: validate,
  formatDine: formatDine,
  toDateKey: toDateKey,
}
