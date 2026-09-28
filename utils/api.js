// 云函数调用封装：全应用唯一出口
// 走 wx.cloud.callFunction（微信内部通道），不需要任何 request 合法域名，
// 因此真机 / 体验版 / 正式版都能正常访问数据。
const FN_NAME = 'lovekitchen'

/**
 * 调用云函数
 * @param {string} action 业务动作，见 cloudfunctions/lovekitchen/index.js 的 ACTIONS
 * @param {object} [payload] 附加参数
 * @returns {Promise<object>} 业务数据；失败时抛错，由调用方 catch
 */
async function call(action, payload) {
  const event = Object.assign({ action: action }, payload || {})

  let res
  try {
    res = await wx.cloud.callFunction({ name: FN_NAME, data: event })
  } catch (err) {
    // 网络层失败（环境未初始化、云函数不存在、超时等）
    const msg = (err && (err.errMsg || err.message)) || '网络异常'
    const wrapped = new Error('云函数调用失败：' + msg)
    wrapped.cause = err
    throw wrapped
  }

  const result = (res && res.result) || {}
  if (!result.ok) {
    throw new Error(result.error || '服务端返回异常')
  }
  return result
}

module.exports = { call, FN_NAME }
