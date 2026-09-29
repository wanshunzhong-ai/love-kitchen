// 待做页：做饭人「今天」的厨房看板
//   · 只看今天：按一日三餐（早餐 / 午餐 / 晚餐 / 夜宵）分格，一眼看清每顿要做啥
//   · 卡片上直接「▶ 开始做 / ✅ 做好了」推进状态，不用再跳订单页
//   · 后面的单子只做摘要，点一下去中间的「订单」页（那里能看到全部订单）
//   · 状态写的是云端同一个接口，中间订单页 onShow 重拉，两边自然同步
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const store = require('../../utils/store')
const dine = require('../../utils/dine')
const board = require('../../utils/todo')
const { ORDER_STATUS } = require('../../utils/constants')

Page({
  data: {
    todayLabel: '',
    // 今天的分格：[{ key, emoji, text, orders, orderCount, dishCount, showDine }]
    meals: [],
    todayCount: 0,
    todayDishes: 0,
    // 后面几天：只有摘要，不铺菜品
    laterGroups: [],
    laterDishes: 0,
    heroSub: '',
    isEmpty: true,
    loading: true,
    loadError: false,
    statusMap: ORDER_STATUS,
    // 只有做饭人能推进状态；点餐人进来自动弹回点单页（兜底）
    isCook: true,
  },

  onShow() {
    // 自定义 tabBar：同步选中态 + 按身份重算 tab 列表
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 'todo' })
      this.getTabBar().refresh()
    }
    // 身份守卫：没选过身份 → 送去选择页
    const role = store.ensureRole()
    if (!role) return
    // 点餐人没有这块看板（tab 里也没有），从别的路径进来就送回去
    if (role !== 'cook') {
      ui.toast('待做清单是做饭人的看板哦')
      wx.switchTab({ url: '/pages/menu/menu' })
      return
    }
    this.setData({ isCook: true })
    this.loadOrders()
  },

  /** silent：状态推进后的静默重拉，不闪 loading */
  async loadOrders(opts) {
    const silent = !!(opts && opts.silent === true)
    if (!silent) this.setData({ loading: true, loadError: false })
    try {
      const res = await api.call('listOrders')
      const todayKey = dine.toDateKey(new Date())
      const b = board.buildBoard(res.orders || [], todayKey)
      this.setData({
        todayLabel: board.dateLabel(todayKey),
        meals: b.meals,
        todayCount: b.todayCount,
        todayDishes: b.todayDishes,
        laterGroups: b.laterGroups,
        laterDishes: b.laterDishes,
        isEmpty: b.isEmpty,
        heroSub: board.heroSub(b),
        loading: false,
        loadError: false,
      })
    } catch (err) {
      console.error('[todo] 订单加载失败', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  // 推进状态：先写云端，成功后静默重拉（做完的单会自己从清单里消失）
  async advance(id, next) {
    if (!id) return
    ui.showLoading('处理中…')
    try {
      const res = await api.call('updateOrderStatus', { id: id, status: next })
      ui.hideLoading()
      if (!res || !res.updated) {
        ui.toast('没更新成功，再试一次')
        return
      }
      ui.toast(next === 'cooking' ? '开做啦，加油 💪' : '上菜咯，开饭 🎉')
      this.loadOrders({ silent: true })
    } catch (err) {
      ui.hideLoading()
      console.error('[todo] 状态更新失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  onStartCooking(e) {
    this.advance(e.currentTarget.dataset.id, 'cooking')
  },

  // 「已上菜」是不可逆的终态（之后只能删单）→ 二次确认防误点
  onFinishCooking(e) {
    const id = e.currentTarget.dataset.id
    const self = this
    wx.showModal({
      title: '这一单都上菜啦？',
      content: '标记「已上菜」后就不能再改了哦',
      confirmText: '上菜咯',
      confirmColor: '#FF7A9E',
      cancelText: '再做会儿',
      success: function (res) {
        if (res.confirm) self.advance(id, 'done')
      },
    })
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  onPullDownRefresh() {
    this.loadOrders().finally(function () {
      wx.stopPullDownRefresh()
    })
  },
})
