// 轻量 UI 反馈封装（loading / toast）
//
// 为什么需要这层封装：
//   微信开发者工具的「自动化测试」（miniprogram-automator）在模拟交互时，要求每个
//   异步 UI API 都能被判定为「已完成」。wx.showLoading / wx.hideLoading 属于
//   无回调的异步 API —— 不传 success 回调时，自动化框架无法确认调用结束，
//   会抛出「交互未能完整模拟：wx.showLoading is not a function」这类报错。
//   因此这里统一补上空回调，让人工点击与自动化测试都稳定通过。
//
// 说明：这些方法是纯 UI 反馈，失败也不该影响主流程，所以全部做了存在性判断，
//      在极老的基础库上也不会把主流程带崩。
//
// 注意：用 typeof wx === 'undefined' 判断，而不是直接写 !wx ——
//      若 wx 是未声明的变量，直接引用会抛 ReferenceError，反而不安全。

// 取 wx 对象；不存在时返回 null
function getWx() {
  return typeof wx !== 'undefined' ? wx : null
}

// 显示 loading。mask 默认开启，防止用户在请求途中重复点击。
function showLoading(title, mask) {
  const api = getWx()
  if (!api || typeof api.showLoading !== 'function') return
  api.showLoading({
    title: title || '加载中…',
    mask: mask !== false,
    success: function () {},
    fail: function () {},
    complete: function () {},
  })
}

// 隐藏 loading。与 showLoading 成对出现，重复调用也安全。
function hideLoading() {
  const api = getWx()
  if (!api || typeof api.hideLoading !== 'function') return
  api.hideLoading({
    success: function () {},
    fail: function () {},
    complete: function () {},
  })
}

// 提示。icon 默认 none（不显示图标，纯文字更清爽）。
function toast(title, icon, duration) {
  const api = getWx()
  if (!api || typeof api.showToast !== 'function') return
  api.showToast({
    title: title || '',
    icon: icon || 'none',
    duration: duration || 1500,
    success: function () {},
    fail: function () {},
    complete: function () {},
  })
}

module.exports = { showLoading, hideLoading, toast }
