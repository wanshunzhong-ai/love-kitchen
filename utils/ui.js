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

/**
 * toast 的默认停留时长（毫秒）。
 *
 * 导出它的原因：toast 结束后要跳走（下单成功回订单页、菜不存在了返回列表）
 * 这类场景，定时器的延时必须 ≥ 这个值 —— 否则页面先跳走，toast 被一起收掉，
 * 用户根本没看清写了什么。两边写死各自的数字迟早会漂移。
 */
const TOAST_DURATION = 1500

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
    duration: duration || TOAST_DURATION,
    success: function () {},
    fail: function () {},
    complete: function () {},
  })
}

// ---------------------------------------------------------------------------
// 弹窗取一段文字（驳回理由、单道菜备注这类「问一句话」的场景）
//
// 为什么用 Promise 包一层：wx.showModal / showActionSheet 都是回调式 API，
// 页面里写回调会让「弹窗 → 校验 → 发请求」这条链层层嵌套；包成 Promise
// 之后页面可以用 async/await 顺着读下来。
// ---------------------------------------------------------------------------

/**
 * 弹一个可输入的对话框。
 * @returns {Promise<string|null>} 确认时给出去掉首尾空白的文本（可能是空串）；
 *          取消 / 环境不支持时给 null
 */
function askText(options) {
  const api = getWx()
  const opts = options || {}
  return new Promise(function (resolve) {
    if (!api || typeof api.showModal !== 'function') return resolve(null)
    api.showModal({
      title: opts.title || '说一句',
      editable: true,
      placeholderText: opts.placeholder || '',
      content: opts.value || '',
      confirmText: opts.confirmText || '好了',
      cancelText: opts.cancelText || '算了',
      success: function (res) {
        if (!res || !res.confirm) return resolve(null)
        resolve(String(res.content === null || res.content === undefined ? '' : res.content).trim())
      },
      fail: function () {
        resolve(null)
      },
      complete: function () {},
    })
  })
}

/**
 * 问一句驳回理由：先给一排快捷说法（点一下就完事），最后一项是自己写。
 *
 * 为什么不直接弹输入框：手机上一句话打半天，而常见的驳回原因就那么几个
 * （食材不够 / 来不及做 / 换个别的），一键选掉最省事。
 * @param {string[]} quick 快捷说法
 * @param {object} [options] { title, placeholder, confirmText, cancelText }
 * @returns {Promise<string|null>} 取消返回 null；文本可能为空串，由调用方校验
 */
function askReason(quick, options) {
  const api = getWx()
  const opts = options || {}
  const list = (Array.isArray(quick) ? quick : []).filter(function (t) {
    return typeof t === 'string' && t
  })

  return new Promise(function (resolve) {
    // 没有快捷项（或环境不支持 actionSheet）→ 直接进输入框
    if (!list.length || !api || typeof api.showActionSheet !== 'function') {
      return askText(opts).then(resolve, function () {
        resolve(null)
      })
    }

    api.showActionSheet({
      // 最后一项固定是「自己写一句」—— 快捷项再多，也要留一条自由写的路
      itemList: list.concat(['✍️ 自己写一句']),
      success: function (res) {
        const idx = res ? Number(res.tapIndex) : -1
        if (idx >= 0 && idx < list.length) return resolve(list[idx])
        askText(opts).then(resolve, function () {
          resolve(null)
        })
      },
      // 用户点了取消 / 点空白处关闭 → 什么都不做
      fail: function () {
        resolve(null)
      },
      complete: function () {},
    })
  })
}

/**
 * 弹一个纯提示框（不问内容，就两个按钮）。
 * 用 Promise 包一层的原因同 askText：调用方要按「用户点了哪个按钮」决定下一步。
 * @param {object} options { title, content, confirmText, cancelText, showCancel }
 * @returns {Promise<boolean>} 点了主按钮（确认）给 true；点取消 / 环境不支持给 false
 */
function alert(options) {
  const api = getWx()
  const opts = options || {}
  return new Promise(function (resolve) {
    if (!api || typeof api.showModal !== 'function') return resolve(false)
    api.showModal({
      title: opts.title || '提示',
      content: opts.content || '',
      // 只有一个按钮时（showCancel: false）用户没有别的选择，按确认收场
      showCancel: opts.showCancel !== false,
      confirmText: opts.confirmText || '好的',
      cancelText: opts.cancelText || '知道了',
      success: function (res) {
        resolve(!!(res && res.confirm))
      },
      fail: function () {
        resolve(false)
      },
      complete: function () {},
    })
  })
}

// 轻触感反馈。type: 'light'（轻点，默认）/ 'medium' / 'heavy'（重确认）。
// 真机才有振动器，工具与老基础库上静默跳过，绝不影响主流程。
function haptic(type) {
  const api = getWx()
  if (!api || typeof api.vibrateShort !== 'function') return
  api.vibrateShort({
    type: ['light', 'medium', 'heavy'].indexOf(type) >= 0 ? type : 'light',
    success: function () {},
    fail: function () {},
    complete: function () {},
  })
}

module.exports = { TOAST_DURATION, showLoading, hideLoading, toast, askText, askReason, alert, haptic }
