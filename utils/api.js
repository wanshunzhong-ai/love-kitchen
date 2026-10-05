// 数据调用封装：全应用唯一数据出口
//
// 两类数据，两种来源，对页面都是同样的 Promise 形状，
// 因此 pages/ 下所有页面无需关心底层到底是哪一种：
//
//   1) 菜品（菜单）→ 内置在小程序端（utils/dishes.js）
//      菜单主体是静态数据（303 道菜），内置进代码最快：零后台配置、离线可用、读取零延迟。
//      只有「掌勺人新增的菜」走云端（utils/dish-cloud.js，清单 C28），
//      因为干饭人的点单页也得看得到，而两台手机的本地存储互不可见。
//
//   2) 订单 → WorkBuddy 云服务 PostgreSQL（utils/orders.js，小程序直连）
//      订单要两个人共享，必须进真数据库。
//      云服务自带网关与授权，小程序端零密钥；权限在数据库侧用 RLS 控制。
//
// 历史包袱说明（都已废弃并删除，不要再回头走）：
//   · 云函数方案（wx.cloud.callFunction）—— 云函数环境不注入登录态，
//     以匿名身份访问数据库时能读不能写；
//   · 自建 CloudBase 环境 —— 要求环境绑定当前小程序 AppID，
//     本项目用的环境 WxAppId 为空，绑不上，整体换成了 WorkBuddy 云服务。
const localDishes = require('./dishes')
const localOrders = require('./orders')
const localLogs = require('./dish-logs')

// 菜品 action：由 utils/dishes.js 接管
// syncDishes 是共享菜单同步（C28）：掌勺人新增的菜上云，干饭人点单页也能看到
const DISH_ACTIONS = ['listDishes', 'getDish', 'saveDish', 'deleteDish', 'importDishes', 'syncDishes']

// 菜单日志 action：由 utils/dish-logs.js 接管（日志必须上云，本地读不到对方的改动）
const LOG_ACTIONS = ['listDishLogs']

// 订单 action：由 utils/orders.js 接管
const ORDER_ACTIONS = [
  'listOrders',
  'getOrder',
  'createOrder',
  // 改内容：只有干饭人（下单的人）能调；状态改了也不认
  'updateOrder',
  // 推进状态 / 收回驳回：只有掌勺人能调
  'updateOrderStatus',
  // 驳回：掌勺人，必须带理由
  'rejectOrder',
  'deleteOrder',
  'saveReview',
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

  if (LOG_ACTIONS.indexOf(action) >= 0) {
    return localLogs.handle(action, args)
  }

  throw new Error('未知的 action: ' + action)
}

module.exports = {
  call,
  DISH_ACTIONS,
  ORDER_ACTIONS,
  LOG_ACTIONS,
}
