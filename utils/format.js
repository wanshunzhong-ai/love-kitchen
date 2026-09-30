// 时间显示：今天显示「今天 HH:mm」，今年显示「M-D HH:mm」，往年带年份
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatTime(value) {
  if (!value) return ''
  // PostgREST 返回的时间可能是带空格的格式，统一成 ISO 以兼容 iOS
  const normalized = String(value).replace(' ', 'T')
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (d.toDateString() === now.toDateString()) {
    return '今天 ' + hm
  }
  const md = (d.getMonth() + 1) + '-' + pad(d.getDate())
  if (d.getFullYear() === now.getFullYear()) {
    return md + ' ' + hm
  }
  return d.getFullYear() + '-' + md + ' ' + hm
}

/**
 * 只要时钟：'12:30'
 *
 * 用在「已经按天分好组」的列表里（菜品操作日志）：组头写着今天/昨天，
 * 条目里再重复一遍「今天 12:30」就啰嗦了。
 */
function formatClock(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 日期组头的文案：'今天' / '昨天' / '9月28日'（跨年时带年份）
 *
 * 按「零点」相减算天数差，而不是拿毫秒数除 86400000 ——
 * 后者在夏令时切换那天会差一小时，把昨天的记录算成今天。
 *
 * @param {number} value 毫秒时间戳
 * @param {number} [nowTs] 参照时刻，默认取当前时间；测试里可固定住
 */
function formatDayLabel(value, nowTs) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const now = new Date(nowTs === undefined ? Date.now() : nowTs)
  const midnight = function (x) {
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  }
  const diffDays = Math.round((midnight(now) - midnight(d)) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  const md = d.getMonth() + 1 + '月' + d.getDate() + '日'
  return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md
}

module.exports = { formatTime, formatClock, formatDayLabel }
