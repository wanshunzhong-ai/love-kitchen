// 用餐时间：日期 + 时段的纯函数工具（checkout / order-edit / orders 共用）
//
// 日期范围：今天（含）～ 今天 + DINE_MAX_AHEAD_DAYS（最多提前一周预定）。
// 时段：早 / 中 / 晚 / 夜宵（DINE_SLOTS）。今天的时段过了截止时刻就不可再订，
//       明天起全部可选。
//
// 所有函数都接受 now 参数（默认当前时间），方便测试注入固定时间。
// 时间一律用本地时区——点菜的人和做饭的人在同一座城市，语义最直观。

const { DINE_SLOTS, DINE_MAX_AHEAD_DAYS } = require('./constants')

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
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

// 从今天（含）起、共 1 + DINE_MAX_AHEAD_DAYS 天的日期选项
// label：今天 / 明天 / 周X；sub：M/D；value：'YYYY-MM-DD'
function buildDateOptions(now) {
  const base = now || new Date()
  const options = []
  for (let offset = 0; offset <= DINE_MAX_AHEAD_DAYS; offset++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
    const label = offset === 0 ? '今天' : offset === 1 ? '明天' : WEEK_LABELS[d.getDay()]
    options.push({
      value: toDateKey(d),
      label: label,
      sub: d.getMonth() + 1 + '/' + d.getDate(),
      weekday: WEEK_LABELS[d.getDay()],
    })
  }
  return options
}

// 指定日期 + 当前时间下，可订的时段（今天的已过时段 disabled）
function buildSlotOptions(now, dateValue) {
  const base = now || new Date()
  const isToday = dateValue === toDateKey(base)
  const hour = base.getHours()
  return DINE_SLOTS.map(function (slot) {
    return {
      key: slot.key,
      text: slot.text,
      emoji: slot.emoji,
      // 只有「今天 + 已过截止时刻」才禁用（夜宵 endHour=24 恒可选）
      disabled: isToday && hour >= slot.endHour,
    }
  })
}

// 默认时段：今天第一个还可订的；全过时（理论上只有深夜订明早）取第一个
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
  const slot = DINE_SLOTS.find(function (s) {
    return s.key === dineSlot
  })
  return slot ? dateText + ' · ' + slot.text : dateText
}

module.exports = {
  buildDateOptions: buildDateOptions,
  buildSlotOptions: buildSlotOptions,
  defaultSlot: defaultSlot,
  validate: validate,
  formatDine: formatDine,
  toDateKey: toDateKey,
}
