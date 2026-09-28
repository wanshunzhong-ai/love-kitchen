// 爱心小厨房 · 应用入口
//
// 数据来源分两块：
//   · 菜单（101 道菜）→ 内置在 utils/dishes.js，不需要任何后台配置；
//   · 订单 → 小程序直连 CloudBase PostgreSQL（utils/orders.js），
//            微信身份天然可用，读取数据库无需任何服务端密钥。
//
// 这里初始化云开发只是为了拿到数据库连接能力；
// 即使初始化失败，小程序照样能用（菜单走本地内置数据），只是订单功能不可用。
App({
  onLaunch() {
    if (!wx.cloud) {
      console.warn('[app] 当前基础库版本过低（需 2.2.3+），订单功能暂不可用；菜单走本地内置数据，不受影响')
      return
    }
    try {
      wx.cloud.init({
        // 显式指定环境，避免多环境时命中错误的一个
        env: 'zws-04161130-l-d6gd7g8f0c8c7fb17',
        traceUser: true,
      })
    } catch (err) {
      // 云开发异常不能阻断启动，否则会白屏
      console.warn('[app] 云开发初始化失败，订单功能暂不可用（菜单走本地数据，不受影响）：', err)
    }
  },
})
