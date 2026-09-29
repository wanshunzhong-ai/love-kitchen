// 待做页：掌勺人「今天」的厨房看板
//   · 只看今天：按一日三餐（早餐 / 午餐 / 晚餐 / 夜宵）分格，一眼看清每顿要做啥
//   · 卡片上直接「▶ 开始做 / ✅ 做好了」推进状态，不用再跳订单页
//   · 后面的单子只做摘要，点一下去中间的「订单」页（那里能看到全部订单）
//
// 实时性：
//   轮询器是 App 级的（app.js 里起，见 utils/live.js），本页只做两件事 ——
//   订阅数据把看板重画一遍、发现变化时浮一句话提示。
//   所以「干净 15 秒也行、来了单立刻也行」：有待开做的单时轮询是 15 秒一档。
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const store = require('../../utils/store')
const dine = require('../../utils/dine')
const board = require('../../utils/todo')
const live = require('../../utils/live')
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
    // 只有掌勺人能推进状态；干饭人进来自动弹回点单页（兜底）
    isCook: true,
    // 轮询发现变化时浮出来的一句话提示（几秒后自己消失）
    notice: null,
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
    // 干饭人没有这块看板（tab 里也没有），从别的路径进来就送回去
    if (role !== 'cook') {
      ui.toast('待做清单是掌勺人的看板哦')
      wx.switchTab({ url: '/pages/menu/menu' })
      return
    }
    this.setData({ isCook: true })
    this.startLive()
  },

  onHide() {
    this.stopLive()
  },

  onUnload() {
    this.stopLive()
  },

  // ---------- 订阅实时数据 ----------

  startLive() {
    const self = this
    this.unsub = live.subscribe(function (d, orders, err) {
      if (err) {
        console.error('[todo] 轮询失败', err)
        // 已经有内容了就静默等下一轮（退避到最长 2 分钟）；一次都没拉到才给错误态
        if (self.data.loading) self.setData({ loading: false, loadError: true })
        return
      }
      self.render(orders)
      const n = live.notice(d, orders, 'cook')
      if (n) self.showNotice(n)
    })
    // 兜底：冷启动直接编译到本页、或刚在身份页选完身份时，App.onShow 不会重跑，
    // 这时自己把轮询器拉起来（live.watch 是单例，重复调只会顶掉自己）
    if (!live.watching()) {
      live.watch({
        role: function () {
          return store.getRole()
        },
      })
    }
    // 已经有数据就直接画，别让用户对着转圈等下一轮
    if (live.hasData()) {
      this.render(live.currentOrders())
    } else {
      this.setData({ loading: true, loadError: false })
    }
    // 进页面再补一轮最新：轮询可能刚好处在 60 秒那一档，等下一轮太久
    live.refreshNow()
  },

  stopLive() {
    if (this.unsub) {
      this.unsub()
      this.unsub = null
    }
    // 本页可能暂停过轮询（二次确认弹窗），离开时必须恢复，否则别的页面就静了
    live.resume()
    this.hideNotice()
  },

  /** 订单列表 → 看板数据 */
  render(orders) {
    const todayKey = dine.toDateKey(new Date())
    const b = board.buildBoard(orders || [], todayKey)
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
  },

  // ---------- 变化提示条 ----------

  showNotice(n) {
    if (!n) return
    if (this._noticeTimer) clearTimeout(this._noticeTimer)
    this.setData({ notice: n })
    const self = this
    this._noticeTimer = setTimeout(function () {
      self.setData({ notice: null })
      self._noticeTimer = null
    }, 6000)
  },

  hideNotice() {
    if (this._noticeTimer) {
      clearTimeout(this._noticeTimer)
      this._noticeTimer = null
    }
    if (this.data.notice) this.setData({ notice: null })
  },

  onTapNotice() {
    const n = this.data.notice
    this.hideNotice()
    if (!n || !n.path) return
    // 提示指向的就是本页（来了新单）→ 东西已经在眼前了，点一下只是收起提示
    if (n.path === '/pages/todo/todo') return
    wx.switchTab({ url: n.path })
  },

  // ---------- 推进状态 ----------

  // 推进状态：先写云端，成功后立刻补一轮轮询（做完的单会自己从清单里消失）
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
      live.refreshNow()
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
    // 弹窗期间暂停轮询：列表要是在对话框底下自己变了，用户会以为点错了
    live.pause()
    wx.showModal({
      title: '这一单都上菜啦？',
      content: '标记「已上菜」后就不能再改了哦',
      confirmText: '上菜咯',
      confirmColor: '#FF7A9E',
      cancelText: '再做会儿',
      complete: function () {
        live.resume()
      },
      success: function (res) {
        if (res.confirm) self.advance(id, 'done')
      },
    })
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  // 加载失败后的重试：手动补一轮
  onRetry() {
    this.setData({ loading: true, loadError: false })
    live.refreshNow()
  },

  onPullDownRefresh() {
    const done = function () {
      wx.stopPullDownRefresh()
    }
    live.refreshNow().then(done, done)
  },
})
