// 订单页：全部订单都能看到，但操作按身份分工——
//   掌勺人：**只能**推进状态（待开做 → 开做中 → 已上菜）或驳回（必须写理由）；
//           干饭人发起的这一单，他不改内容（不给编辑入口，编辑页也退化成只读）。
//   干饭人：下单 / 改单 / 删单 / 评价，**不碰状态** —— 被驳回的单改完重新提交，
//           状态由服务端自动退回「待开做」。
//
// 实时性：
//   轮询器是 App 级的（app.js 里起，见 utils/live.js），本页只订阅数据 ——
//   于是「掌勺人点了开始做」这一下，干饭人这边列表会自己变，不需要下拉。
//   变化时浮一句话提示；自己操作引起的变化不会提示，免得吵。
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
const store = require('../../utils/store')
const review = require('../../utils/review')
const rejectLib = require('../../utils/reject')
const avoidsLib = require('../../utils/avoids')
const live = require('../../utils/live')
const { ORDER_STATUS, STATUS, DEFAULT_SPICE, spiceInfo, CONFIRM_COLOR, DEFAULT_NAME, NOTICE_MS, UNDO_MS } = require('../../utils/constants')
const { formatTime } = require('../../utils/format')

Page({
  data: {
    orders: [],
    filteredOrders: [],
    filters: [
      { key: '全部', emoji: '📋' },
      { key: STATUS.pending, emoji: '📝' },
      { key: STATUS.cooking, emoji: '🧑‍🍳' },
      { key: STATUS.done, emoji: '🎉' },
      { key: STATUS.rejected, emoji: '🙅' },
    ],
    activeFilter: '全部',
    statusMap: ORDER_STATUS,
    // 模板里判状态用 statusKeys.pending，不写字面量（枚举只有一份，见 utils/constants.js）
    statusKeys: STATUS,
    loading: true,
    loadError: false,
    // 身份：cook 才有「开始做 / 做好了」按钮；orderer 看到的是「等掌勺人开做」提示
    role: '',
    roleInfo: null,
    isCook: false,
    // 轮询发现变化时浮出来的一句话提示
    notice: null,
  },

  onShow() {
    // 自定义 tabBar：同步选中态 + 按身份重算 tab 列表
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 'orders' })
      this.getTabBar().refresh()
    }
    // 身份守卫：没选过身份 → 送去选择页
    const role = store.ensureRole()
    if (!role) return
    this.setData({
      role: role,
      roleInfo: store.getRoleInfo(),
      isCook: role === 'cook',
    })
    // 同一个页面两种身份标题不同：干饭人看的是「我的订单」，掌勺人看的是厨房「订单」
    wx.setNavigationBarTitle({ title: role === 'cook' ? '订单' : '我的订单' })
    this.startLive()
  },

  onHide() {
    this.stopLive()
  },

  onUnload() {
    this.stopLive()
  },

  // 身份胶囊：进「我的」tab（基本资料）
  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  // ---------- 订阅实时数据 ----------

  startLive() {
    // 防重入：onShow 可能被连着触发（切 tab 回来 + 下拉刷新），
    // 没有这一句后一次订阅会把前一次的 unsub 覆盖掉 —— 旧订阅就永久泄漏了
    // （照抄 menu.js::watchOrders 的做法）
    if (this.unsub) return
    const self = this
    this.unsub = live.subscribe(function (d, orders, err) {
      if (err) {
        console.error('[orders] 轮询失败', err)
        // 已经有内容了就静默等下一轮；一次都没拉到才给错误态
        if (self.data.loading) self.setData({ loading: false, loadError: true })
        return
      }
      // 数据没变就别重画整棵列表：d.primed = 已过首帧，d.any = 有真实变化。
      // 15 秒一档的轮询里绝大多数轮次都是「没变」，全量 map + setData 纯白耗。
      if (d && d.primed && !d.any) return
      self.render(orders)
      // 提示文案按「当前身份」算：同一个页面掌勺人看到的是「来新单」，
      // 干饭人看到的是「开始做 / 上菜了」
      const n = live.notice(d, orders, store.getRole())
      if (n) self.showNotice(n)
    })
    // 兜底：冷启动直接编译到本页、或刚在身份页选完身份时，App.onShow 不会重跑
    if (!live.watching()) {
      live.watch({
        role: function () {
          return store.getRole()
        },
      })
    }
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
    live.resume()
    this.hideNotice()
  },

  /**
   * 订单列表 → 页面数据。
   * 首屏和后续每轮轮询都走这里，所以「刷新」和「发现变化」共用一次请求。
   */
  render(rawOrders) {
    const orders = (rawOrders || []).map(function (o) {
      // 逐道菜的评价（键 = dishId|辣度，与评价页 / 编辑页同一套规则）
      const reviews = review.normalizeReviews(o.reviews)
      const items = review.decorateItems(o.items, reviews).map(function (it) {
        const info = spiceInfo(it.spice)
        const rating = it.review ? it.review.rating : 0
        return Object.assign({}, it, {
          // 同一道菜可能有多种辣度，rowKey 必须带上辣度才唯一
          rowKey: it.key,
          spiceIdx: info.level,
          spiceText: info.level > 0 ? '🌶️'.repeat(info.level) : DEFAULT_SPICE,
          // 星级拆成「亮星 + 暗星」两段，wxml 里直接拼，不写循环
          starFull: rating > 0 ? '★'.repeat(rating) : '',
          starDim: rating > 0 ? '☆'.repeat(review.RATING_MAX - rating) : '',
        })
      })
      const status = o.status || STATUS.pending
      const rejected = status === STATUS.rejected
      return Object.assign({}, o, {
        id: o._id || o.id,
        status: status,
        items: items,
        timeText: formatTime(o.created_at),
        // 「周三 9/30 · 午餐」；老订单没填 → 「尽快」
        dineText: dine.formatDine(o.dine_date, o.dine_slot),
        // 这一单的评价进度，给卡片上那行小字用
        reviewSummary: review.summarize(o.items, reviews),
        // 驳回：理由只在「已驳回」时露出来；顺手算一封能渲染的兜底文案
        rejectText: rejected ? o.reject_reason || '没写理由' : '',
        rejectTimeText: rejected && o.rejected_at ? formatTime(o.rejected_at) : '',
        // 忌口快照 → 一句话；空串表示 TA 没记忌口，卡片上就不出这一条
        avoidsText: avoidsLib.textOf(o.avoids),
        // 按钮显隐交给数据算，wxml 里只读布尔值（模板里堆逻辑最难查）
        canReject: rejectLib.canReject(status),
      })
    })
    this.setData({ orders: orders, loading: false, loadError: false })
    this.applyFilter()
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
    }, NOTICE_MS)
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
    // 撤销删除的提示条：点了就反悔
    if (n && n.undo) {
      this.onUndoDelete()
      return
    }
    this.hideNotice()
    if (!n || !n.path) return
    // 已经在订单页了（本页就是提示的目标）→ 收起提示就行
    if (n.path === '/pages/orders/orders') return
    wx.switchTab({ url: n.path })
  },

  // 加载失败后的重试
  onRetry() {
    this.setData({ loading: true, loadError: false })
    live.refreshNow()
  },

  applyFilter() {
    const { orders, activeFilter } = this.data
    const filteredOrders =
      activeFilter === '全部'
        ? orders
        : orders.filter(function (o) {
            return o.status === activeFilter
          })
    this.setData({ filteredOrders: filteredOrders })
  },

  onFilterTap(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.key })
    this.applyFilter()
  },

  /**
   * 按 id 找订单。
   *
   * 不用「列表下标」：`updateStatus` 里 `await` 写库的这段时间，轮询可能已经
   * 全量重画过列表（筛选条件没变也可能因为别的单变了而重排）—— 回来时下标
   * 可能已经指向另一单，于是「点 A 开工、B 变了状态」。id 不受重画影响。
   * 查的是 orders（全量）而不是 filteredOrders：单子可能因为状态变化
   * 被筛出当前筛选结果，但用户点的确实是它。
   */
  findOrder(id) {
    return (
      this.data.orders.find(function (o) {
        return String(o.id) === String(id)
      }) || null
    )
  },

  // 推进状态：写入云端后本地同步，失败时明确提示
  async updateStatus(id, nextStatus) {
    const order = this.findOrder(id)
    if (!order) return
    // 兜底：状态是掌勺人的活，干饭人的界面不该出现这条路径
    if (!this.data.isCook) {
      ui.toast('订单状态由掌勺人更新哦')
      return
    }
    ui.showLoading('处理中…')
    try {
      const res = await api.call('updateOrderStatus', {
        id: order.id,
        status: nextStatus,
      })
      ui.hideLoading()
      if (!res.updated) {
        ui.toast('没更新成功，再试一次')
        return
      }
      const orders = this.data.orders.map(function (o) {
        return o.id === order.id ? Object.assign({}, o, { status: nextStatus }) : o
      })
      this.setData({ orders: orders })
      this.applyFilter()
      ui.toast(ORDER_STATUS[nextStatus].text)
      ui.haptic('medium')
    } catch (err) {
      ui.hideLoading()
      console.error('[orders] 状态更新失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  onStartCooking(e) {
    this.updateStatus(e.currentTarget.dataset.id, STATUS.cooking)
  },

  // 「已上菜」是终态（之后只能删单）→ 与待做页一致，二次确认防误点
  onFinishCooking(e) {
    const id = e.currentTarget.dataset.id
    const self = this
    // 弹窗期间暂停轮询：列表要是在对话框底下自己变了，用户会以为点错了
    live.pause()
    wx.showModal({
      title: '这一单都上菜啦？',
      content: '标记「已上菜」后就不能再改了哦',
      confirmText: '上菜咯',
      confirmColor: CONFIRM_COLOR,
      cancelText: '再做会儿',
      complete: function () {
        live.resume()
      },
      success: function (res) {
        if (res.confirm) self.updateStatus(id, STATUS.done)
      },
    })
  },

  // ---------- 驳回（掌勺人专属） ----------
  //
  // 驳回不是「第四个状态按钮」，它必须说一句为什么：
  // 先给一排快捷说法（手机上一键选），想写别的就选「自己写一句」。
  // 驳回后球回到干饭人那边，他改完重新提交，状态自动回到「待开做」。
  async onReject(e) {
    const order = this.findOrder(e.currentTarget.dataset.id)
    if (!order) return
    if (!this.data.isCook) {
      ui.toast('驳回是掌勺人的活哦')
      return
    }
    if (!rejectLib.canReject(order.status)) {
      ui.toast(order.status === STATUS.done ? '已经上菜啦，没法驳回' : '这一单已经驳回了')
      return
    }

    // 弹窗期间暂停轮询：列表在对话框底下自己变了，用户会以为点错了
    live.pause()
    let input = null
    try {
      input = await ui.askReason(rejectLib.QUICK_REASONS, {
        title: '为什么先不做这一单？',
        placeholder: '比如：今天没买到排骨',
        confirmText: '就这么说',
      })
    } finally {
      live.resume()
    }
    if (input === null) return // 取消 = 什么都不做

    const reason = rejectLib.normalizeReason(input)
    if (!reason) {
      ui.toast('还是说一句理由吧')
      return
    }
    await this.doReject(order, reason)
  },

  async doReject(order, reason) {
    ui.showLoading('正在驳回…')
    try {
      const res = await api.call('rejectOrder', { id: order.id, reason: reason })
      ui.hideLoading()
      if (!res.updated) {
        ui.toast('没驳回成功，再试一次')
        return
      }
      // 本地先改一份，不必等下一轮轮询
      const orders = this.data.orders.map(function (o) {
        return o.id === order.id
          ? Object.assign({}, o, { status: STATUS.rejected, reject_reason: reason })
          : o
      })
      this.setData({ orders: orders })
      this.applyFilter()
      ui.toast('已经告诉 TA 了 🙅')
    } catch (err) {
      ui.hideLoading()
      console.error('[orders] 驳回失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  // 手滑驳错了 → 收回来（状态退回待开做，理由留着当历史，不再展示）
  onWithdrawReject(e) {
    const order = this.findOrder(e.currentTarget.dataset.id)
    if (!order || order.status !== STATUS.rejected) return
    const self = this
    live.pause()
    wx.showModal({
      title: '收回这次驳回？',
      content: '这一单会回到「待开做」，TA 那边也会看到',
      confirmText: '收回来',
      confirmColor: CONFIRM_COLOR,
      cancelText: '算了',
      complete: function () {
        live.resume()
      },
      success: function (res) {
        if (res.confirm) self.updateStatusByOrder(order, STATUS.pending)
      },
    })
  },

  // 与 updateStatus 同一套写库逻辑，区别是手里拿着订单对象而不是列表下标
  async updateStatusByOrder(order, nextStatus) {
    if (!order) return
    if (!this.data.isCook) {
      ui.toast('订单状态由掌勺人更新哦')
      return
    }
    ui.showLoading('处理中…')
    try {
      const res = await api.call('updateOrderStatus', { id: order.id, status: nextStatus })
      ui.hideLoading()
      if (!res.updated) {
        ui.toast('没更新成功，再试一次')
        return
      }
      const orders = this.data.orders.map(function (o) {
        return o.id === order.id ? Object.assign({}, o, { status: nextStatus }) : o
      })
      this.setData({ orders: orders })
      this.applyFilter()
      ui.toast('已经收回啦 ↩️')
    } catch (err) {
      ui.hideLoading()
      console.error('[orders] 收回驳回失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  // 打开这一单：干饭人进编辑态，掌勺人进只读详情（他只能推进状态 / 驳回）。
  // 已上菜 = 终态、开做中 = 掌勺人已经开火，两边都不给干饭人编辑入口
  // （列表里也不渲染，这里是兜底防误入）
  onEditOrder(e) {
    const order = this.findOrder(e.currentTarget.dataset.id)
    if (!order) return
    if (!this.data.isCook && order.status === STATUS.done) {
      ui.toast('这一单已上菜，只能删掉')
      return
    }
    if (!this.data.isCook && order.status === STATUS.cooking) {
      ui.toast('这一单正在做，先别改啦')
      return
    }
    wx.navigateTo({ url: '/pages/order-edit/order-edit?id=' + order.id })
  },

  // 去给这一单的每道菜打分（只有干饭人 + 已上菜的单才有入口）
  onReview(e) {
    const order = this.findOrder(e.currentTarget.dataset.id)
    if (!order) return
    if (order.status !== STATUS.done) {
      ui.toast('等掌勺人上菜后再评哦')
      return
    }
    wx.navigateTo({ url: '/pages/review/review?id=' + order.id })
  },

  // 删除整单：干饭人删自己点的单（掌勺人不删 TA 点的单，他只能驳回）。
  // 开做中的单删不得 —— 掌勺人正在做，等上菜之后随删。
  onDeleteOrder(e) {
    const order = this.findOrder(e.currentTarget.dataset.id)
    if (!order) return
    if (this.data.isCook) {
      ui.toast('这一单是 TA 点的，你只能驳回哦')
      return
    }
    if (order.status === STATUS.cooking) {
      ui.toast('这一单正在做，等做完再删吧')
      return
    }
    const self = this
    live.pause()
    wx.showModal({
      title: '删掉这一单？',
      content: '删掉后 5 秒内可以撤销',
      confirmText: '删掉',
      confirmColor: CONFIRM_COLOR,
      cancelText: '再想想',
      complete: function () {
        live.resume()
      },
      success: function (res) {
        if (res.confirm) self.doDeleteOrder(order)
      },
    })
  },

  /**
   * 删除 = 先「假装删了」，5 秒后才真正发请求。
   * 本地先移除（列表立刻少一行），顶部出一条「已删除 · 点这里撤销」；
   * 点了撤销就取消定时器并拉回最新数据，没点 5 秒后真正调 deleteOrder。
   * 误触从此有 5 秒反悔期，不再「删掉就找不回来」。
   */
  async doDeleteOrder(order) {
    const self = this
    // 本地同步移除，避免再拉一次接口
    const orders = this.data.orders.filter(function (o) {
      return o.id !== order.id
    })
    this.setData({ orders: orders, loading: false })
    this.applyFilter()

    // 上一单还没删完又删了一单：旧的定时器作废，立刻把上一单真删掉
    if (this._deleteTimer) {
      clearTimeout(this._deleteTimer)
      this._deleteTimer = null
      const prev = this._pendingDelete
      this._pendingDelete = null
      if (prev) {
        // 这条是真删失败也**不会**再出现在列表里（本地已移除），所以要出声 ——
        // 静默失败会让用户以为删掉了，其实云上还在
        api.call('deleteOrder', { id: prev.id }).catch(function (err) {
          console.error('[orders] 删除订单失败', err)
          ui.toast('有一单没删干净，稍后再试一次')
        })
      }
    }
    this._pendingDelete = order
    this.showNotice({
      key: 'deleted',
      undo: true,
      emoji: '🗑️',
      text: '已删除一单，点这里撤销',
    })
    this._deleteTimer = setTimeout(function () {
      self._deleteTimer = null
      const pending = self._pendingDelete
      self._pendingDelete = null
      if (!pending) return
      api.call('deleteOrder', { id: pending.id }).catch(function (err) {
        console.error('[orders] 删除订单失败', err)
        ui.toast('没删干净，稍后再试一次')
      })
    }, UNDO_MS)
  },

  // 提示条上的「撤销」：取消待删定时器，单子随下一轮轮询回来
  onUndoDelete() {
    if (this._deleteTimer) {
      clearTimeout(this._deleteTimer)
      this._deleteTimer = null
    }
    this._pendingDelete = null
    this.hideNotice()
    ui.toast('已撤销，单子回来啦', 'success')
    live.refreshNow()
  },

  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' })
  },

  onPullDownRefresh() {
    const done = function () {
      wx.stopPullDownRefresh()
    }
    live.refreshNow().then(done, done)
  },
})
