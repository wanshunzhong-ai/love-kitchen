// 爱心小厨房 · 应用入口
// 数据全部通过云函数 lovekitchen 读写（wx.cloud.callFunction），
// 不需要配置 request 合法域名，真机 / 体验版都能用。
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[app] 当前基础库版本过低，请使用 2.2.3 及以上版本')
      return
    }
    wx.cloud.init({
      // 不传 env：自动使用你开通云开发时的默认环境（只有一个环境时最省心）
      traceUser: true,
    })
  },
})
