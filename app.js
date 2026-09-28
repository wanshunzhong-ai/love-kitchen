// 爱心小厨房 · 应用入口
//
// 数据来源分两块：
//   · 菜单（101 道菜）→ 内置在 utils/dishes.js，不需要任何后台配置；
//   · 订单 → WorkBuddy 云服务 PostgreSQL（utils/orders.js），
//            小程序端零密钥，连接与鉴权都由 SDK 自动完成。
//
// 云服务客户端是「用到才建」的懒加载（见 utils/orders.js 的 getCloud），
// 所以这里不需要做任何初始化 —— 启动更快，而且万一云服务有问题，
// 也只是订单功能受影响，菜单照样能用。
App({
  onLaunch() {},
})
