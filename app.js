// 爱心小厨房 · 应用入口
//
// 数据来源分两块：
//   · 菜单（101 道菜）→ 内置在 utils/dishes.js，不需要任何后台配置；
//   · 订单 → 走云函数 lovekitchen（wx.cloud.callFunction，微信内部通道，不需要 request 合法域名）。
//
// 因此云开发未开通时小程序照样能用（菜单正常），只是订单功能不可用。
App({
  onLaunch() {
    if (!wx.cloud) {
      console.warn('[app] 当前基础库版本过低（需 2.2.3+），订单功能暂不可用；菜单走本地内置数据，不受影响')
      return
    }
    try {
      wx.cloud.init({
        // 不传 env：自动使用你开通云开发时的默认环境（只有一个环境时最省心）
        traceUser: true,
      })
    } catch (err) {
      // 没开通云开发 / 环境异常都不能阻断启动，否则会白屏
      console.warn('[app] 云开发初始化失败，订单功能暂不可用（菜单走本地数据，不受影响）：', err)
    }
  },
})
