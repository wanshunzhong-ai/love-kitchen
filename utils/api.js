// 云函数调用封装：全应用唯一数据出口
//
// 两种数据源：
//   1) 菜品（菜单）→ 默认走「本地内置数据」（utils/dishes.js），零后台配置即可用；
//      把下面 USE_LOCAL_DISHES 改成 false 就切回云函数。
//   2) 订单 → 走云函数 lovekitchen（wx.cloud.callFunction，微信内部通道），
//      不需要任何 request 合法域名，因此真机 / 体验版 / 正式版都能正常访问。
const localDishes = require('./dishes')

const FN_NAME = 'lovekitchen'

// 菜单是否走本地内置数据：true = 零后台可用（推荐）；false = 走云函数读数据库
const USE_LOCAL_DISHES = true

// 哪些 action 由本地菜品服务接管
const DISH_ACTIONS = ['listDishes', 'getDish', 'saveDish', 'deleteDish', 'stats']

/**
 * 调用数据接口
 * @param {string} action 业务动作
 * @param {object} [payload] 附加参数
 * @returns {Promise<object>} 业务数据；失败时抛错，由调用方 catch
 */
async function call(action, payload) {
  // 菜品类 action：本地实现（同步逻辑，包成 Promise 对齐调用方）
  if (USE_LOCAL_DISHES && DISH_ACTIONS.indexOf(action) >= 0) {
    return localDishes.handle(action, payload || {})
  }

  // 其余（订单类）：走云函数
  const event = Object.assign({ action: action }, payload || {})

  let res
  try {
    res = await wx.cloud.callFunction({ name: FN_NAME, data: event })
  } catch (err) {
    // 网络层失败（环境未初始化、云开发未开通、云函数不存在、超时等）
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

module.exports = { call, FN_NAME, USE_LOCAL_DISHES, DISH_ACTIONS }
