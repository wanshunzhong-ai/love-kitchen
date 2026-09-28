// 数据调用封装：全应用唯一数据出口
//
// 两类数据，两种来源，对页面都是同样的 Promise 形状，
// 因此 pages/ 下所有页面无需关心底层到底是哪一种：
//
//   1) 菜品（菜单）→ 内置在小程序端（utils/dishes.js）
//      菜单是静态数据（101 道菜），内置进代码最快：零后台配置、离线可用、读取零延迟。
//
//   2) 订单 → CloudBase PostgreSQL（utils/orders.js，小程序直连 + RLS 授权）
//      订单要两个人共享，必须进真数据库。
//      小程序端天然带着微信身份（JWT），配好 RLS 策略后即可安全读写，
//      不需要维护任何服务端密钥。
//
// 历史包袱说明：早期版本订单走云函数（wx.cloud.callFunction）。
//   改用 PG 后该路径已废弃并删除 —— 云函数环境不注入 JWT，
//   端点只认微信身份，云函数以匿名身份访问数据库时能读不能写。
const localDishes = require('./dishes')
const localOrders = require('./orders')

// 菜品 action：由 utils/dishes.js 接管
const DISH_ACTIONS = ['listDishes', 'getDish', 'saveDish', 'deleteDish']

// 订单 action：由 utils/orders.js 接管
const ORDER_ACTIONS = [
  'listOrders',
  'getOrder',
  'createOrder',
  'updateOrder',
  'updateOrderStatus',
  'deleteOrder',
]

/**
 * 调用数据接口
 * @param {string} action 业务动作
 * @param {object} [payload] 附加参数
 * @returns {Promise<object>} 业务数据；失败时抛错，由调用方 catch
 */
async function call(action, payload) {
  const args = payload || {}

  if (DISH_ACTIONS.indexOf(action) >= 0) {
    return localDishes.handle(action, args)
  }

  if (ORDER_ACTIONS.indexOf(action) >= 0) {
    return localOrders.handle(action, args)
  }

  throw new Error('未知的 action: ' + action)
}

module.exports = {
  call,
  DISH_ACTIONS,
  ORDER_ACTIONS,
}
