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
//
// 实时监听放在这里（而不是各个页面）：
//   云服务 SDK 没有 realtime 订阅通道，只能前台轮询。轮询器做成 App 级唯一实例，
//   好处是「底栏角标」在任何 tab 页都实时 —— 掌勺人在菜单页翻菜谱时也能看到
//   待做数往上跳，干饭人在资料页也能看到「正在做」的单数。
//   页面各自只负责订阅数据、画列表、弹一句提示（见 pages/todo、pages/orders）。
//
// 「快到点还没开做」的提醒也挂在这条轮询上（utils/deadline.js）：
//   它是全局的、不属于任何页面 —— 掌勺人翻菜单时也该被提醒到。
const live = require('./utils/live')
const deadline = require('./utils/deadline')
const store = require('./utils/store')
const ui = require('./utils/ui')

App({
  onLaunch() {
    // 断网全局感知：没有这层，用户只会看到「点了按钮才弹网络开小差」，
    // 没法解释「为什么单子半天不动」。恢复时也补一句，让人知道能继续了。
    const wxApi = typeof wx !== 'undefined' ? wx : null
    if (!wxApi || typeof wxApi.onNetworkStatusChange !== 'function') return
    wxApi.onNetworkStatusChange(function (res) {
      if (res && res.isConnected === false) {
        ui.toast('网络断开了，恢复后订单会自动同步', 'none', 2500)
      } else if (res && res.isConnected === true && res.networkType && res.networkType !== 'none') {
        ui.toast('网络恢复啦', 'success', 1500)
      }
    })
  },

  // 进前台：有身份了就开始盯着点单情况
  onShow() {
    // role 传函数而不是值：身份在「我的」页切换后不用重建 watcher，下一轮自动跟上
    if (store.getRole()) {
      live.watch({
        role: function () {
          return store.getRole()
        },
        // 每轮成功拉到订单后检查一次「快截止了还没开做」的单（内部自己判身份、自己判去重）
        onTick: function (d, orders) {
          deadline.check(orders)
        },
      })
    }
  },

  // 退到后台：立刻停轮询。小程序后台的 setTimeout 会被限流，
  // 与其留个半死不活的定时器，不如明确停掉，回前台由 onShow 重新拉起。
  onHide() {
    live.unwatch()
  },
})
