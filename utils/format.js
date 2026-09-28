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

module.exports = { formatTime }
