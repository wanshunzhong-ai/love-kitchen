// 确认订单页：改数量、逐道改辣度 / 备注 / 换菜、选用餐时间、写备注、填署名，提交到云端
//
// 关于忌口：这一页会把「我的忌口清单」一起提交上去（payload.avoids）。
// 掌勺人的手机读不到干饭人的本地存储，忌口只有随订单上云对方才看得到 ——
// 所以清单在这里再露一次脸，既让人确认「这些会告诉 TA」，也方便临时补一条。
const api = require('../../utils/api')
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
const { SPICE_LEVELS, spiceInfo, DISH_NOTE_MAX, AVOID_MAX, AVOID_TEXT_MAX } = require('../../utils/constants')

Page({
  data: {
    cart: [],
    totalCount: 0,
    remark: '',
    nickname: '',
    submitting: false,
    spiceLevels: SPICE_LEVELS,
    // 忌口清单（随订单一起送给掌勺人；这里只演示 + 临时补记，完整维护在「我的」页）
    avoids: [],
    avoidMax: AVOID_MAX,
    avoidTextMax: AVOID_TEXT_MAX,
    // 辣度平时只显示「当前选的那一档」；这一行是正在展开重选的那道菜
    spiceOpenUid: '',
    // 逐道菜修改面板（辣度 / 备注 / 换菜）
    editorOpen: false,
    editorUid: '',
    editorItem: null,
    // 用餐时间：日期（今天～一周内）+ 时段（早/中/晚/夜宵）
    dineDates: [],
    dineDate: '',
    dineSlots: [],
    dineSlot: '',
  },

  onShow() {
    // 掌勺人不点单：万一从别的路径进来（购物车已随切身份清空），直接送回订单页
    if (store.getRole() === 'cook') {
      ui.toast('掌勺人不点单哦，等TA来点单 💕')
      wx.switchTab({ url: '/pages/orders/orders' })
      return
    }
    // 每次进来都收起辣度展开态：列表默认只显示选定的那一档
    this.setData({ spiceOpenUid: '' })
    this.refreshCart()
    this.refreshDine()
  },

  // 每次进入都按「当前时刻」重建日期与时段：
  // 跨天 / 时段过期后，之前选的值可能已经不合法
  refreshDine() {
    const now = new Date()
    const dates = dine.buildDateOptions(now)
    let date = this.data.dineDate
    // 选中的那天可能已经不可选了（比如 23:30 之后「今天」四个时段全关）
    const stillValid = dates.some(function (d) {
      return d.value === date && !d.disabled
    })
    if (!stillValid) date = dine.defaultDate(now)
    const slots = dine.buildSlotOptions(now, date)
    let slot = this.data.dineSlot
    const slotHit = slots.find(function (s) {
      return s.key === slot
    })
    if (!slotHit || slotHit.disabled) slot = dine.defaultSlot(now, date)
    this.setData({
      dineDates: dates,
      dineDate: date,
      dineSlots: slots,
      dineSlot: slot,
    })
  },

  onPickDineDate(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.dineDate) return
    const hit = this.data.dineDates.find(function (d) {
      return d.value === value
    })
    if (!hit || hit.disabled) return
    const now = new Date()
    this.setData({
      dineDate: value,
      dineSlots: dine.buildSlotOptions(now, value),
      dineSlot: dine.defaultSlot(now, value),
    })
  },

  onPickDineSlot(e) {
    const key = e.currentTarget.dataset.key
    const hit = this.data.dineSlots.find(function (s) {
      return s.key === key
    })
    if (!hit || hit.disabled) return
    this.setData({ dineSlot: key })
  },

  refreshCart() {
    // 每行补上辣度展示信息：列表里只渲染「选定的那一档」
    const cart = store.getCart().map(function (it) {
      const info = spiceInfo(it.spice)
      return Object.assign({}, it, {
        spiceLevel: info.level,
        spiceLabel: info.label,
      })
    })
    // 展开中的那一行如果被删掉 / 被合并走了，顺手收起，别留下展开态
    let spiceOpenUid = this.data.spiceOpenUid
    if (spiceOpenUid) {
      const alive = cart.some(function (it) {
        return it.uid === spiceOpenUid
      })
      if (!alive) spiceOpenUid = ''
    }
    this.setData({
      cart: cart,
      totalCount: store.cartCount(),
      nickname: store.getNickname(),
      spiceOpenUid: spiceOpenUid,
      avoids: store.getAvoids(),
    })
  },

  // 下单前临时补一条忌口（想管理整份清单去「我的」页）。
  // 用弹窗输入而不是行内 input：本页任何改动都会 refreshCart 重画列表，
  // 受控 input 回写 value 会把光标顶到末尾 —— 这也是本页备注一律走弹窗的原因。
  onAddAvoid() {
    if (this.data.avoids.length >= AVOID_MAX) {
      ui.toast('忌口最多 ' + AVOID_MAX + ' 条')
      return
    }
    const self = this
    wx.showModal({
      title: '不吃什么？',
      editable: true,
      placeholderText: '比如：芥末（最多 ' + AVOID_TEXT_MAX + ' 字）',
      confirmText: '记下',
      cancelText: '算了',
      success: function (res) {
        if (!res.confirm) return
        const text = String(res.content || '').trim()
        if (!text) return
        if (!store.addAvoid(text)) {
          ui.toast('已经在清单里啦')
          return
        }
        self.refreshCart()
        ui.toast('记下了，会一起告诉 TA 🙅', 'success')
      },
    })
  },

  // 数量加减：按行身份（uid）定位，同菜不同辣度互不影响。
  // qty=1 时点「−」不许静默删行——历史上这一下会把菜悄悄删掉，找回都没处找；
  // 改成弹确认，用户真想删就删得明明白白。
  onQtyChange(e) {
    const uid = e.currentTarget.dataset.uid
    const delta = Number(e.currentTarget.dataset.delta)
    if (delta < 0) {
      const row = this.data.cart.find(function (it) {
        return it.uid === uid
      })
      if (row && Number(row.qty) <= 1) {
        const self = this
        wx.showModal({
          title: '把「' + row.name + '」删掉？',
          content: '数量已经是 1 了，再减这一行就没了',
          confirmText: '删掉',
          cancelText: '留着',
          success: function (res) {
            if (!res.confirm) return
            store.removeFromCart(uid)
            if (self.data.editorUid === uid) self.setData({ editorUid: '' })
            self.refreshCart()
          },
        })
        return
      }
    }
    store.changeQty(uid, delta)
    this.refreshCart()
  },

  // 直接删行：同样给个确认，误触不再无法挽回
  onRemoveItem(e) {
    const uid = e.currentTarget.dataset.uid
    const row = this.data.cart.find(function (it) {
      return it.uid === uid
    })
    if (!row) return
    const self = this
    wx.showModal({
      title: '把「' + row.name + '」删掉？',
      confirmText: '删掉',
      cancelText: '留着',
      success: function (res) {
        if (!res.confirm) return
        store.removeFromCart(uid)
        // 面板正开着这一行时，把它一起关掉
        if (self.data.editorOpen && self.data.editorUid === uid) self.closeEditor()
        self.refreshCart()
      },
    })
  },

  // 单道菜的备注：点列表里那一行备注就能直接写，不必打开面板。
  // 用 wx.showModal 的输入模式，而不是行内 input —— 本页每次改动都会 refreshCart 刷新列表，
  // 行内受控 input 回写 value 会把光标顶到末尾，弹窗输入没有这个毛病。
  onTapNote(e) {
    const uid = e.currentTarget.dataset.uid
    const row = this.data.cart.find(function (it) {
      return it.uid === uid
    })
    if (!row) return
    const self = this
    wx.showModal({
      title: '「' + row.name + '」单独说一句',
      editable: true,
      placeholderText: '比如：不放葱（最多 ' + DISH_NOTE_MAX + ' 字）',
      content: row.note || '',
      confirmText: '写好了',
      cancelText: '不改了',
      success: function (res) {
        if (!res.confirm) return
        const raw = String(res.content === null || res.content === undefined ? '' : res.content)
        // setItemNote 内部已经做了 trim + 限长，这里不用再处理
        store.setItemNote(uid, raw)
        self.refreshCart()
        ui.toast(raw.trim() ? '记下来了 📝' : '已清空')
      },
    })
  },

  // 辣度：平时只显示选定的那一档，点一下才就地展开四档重选
  onOpenSpice(e) {
    const uid = e.currentTarget.dataset.uid
    if (!uid) return
    this.setData({ spiceOpenUid: uid })
  },

  // 选中某一档：落库后立刻收起，回到「只显示选定的辣度」
  onTapSpice(e) {
    const uid = e.currentTarget.dataset.uid
    const spice = e.currentTarget.dataset.spice
    const newUid = store.changeSpice(uid, spice)
    // 先收起再刷新，refreshCart 会保留当前值
    this.setData({ spiceOpenUid: '' })
    this.refreshCart()
    // 改辣度可能撞上已有条目而合并，面板跟着换到活下来那一行
    if (this.data.editorOpen && this.data.editorUid === uid && newUid) {
      this.setData({ editorUid: newUid })
    }
  },

  // ---------- 逐道菜修改面板 ----------

  openEditor(e) {
    const uid = e.currentTarget.dataset.uid
    const row = this.data.cart.find(function (it) {
      return it.uid === uid
    })
    if (!row) return
    this.setData({
      editorOpen: true,
      editorUid: uid,
      editorItem: { name: row.name, emoji: row.emoji, spice: row.spice, note: row.note },
    })
  },

  closeEditor() {
    this.setData({ editorOpen: false, editorUid: '', editorItem: null })
  },

  // 面板里的改动落到购物车。注意：改辣度 / 换菜都可能让这一行与别行合并
  // （活下来的那条 uid 会变），所以每一步都接着最新的 uid 往下走。
  onEditorChange(e) {
    const d = e.detail || {}
    let uid = this.data.editorUid
    if (!uid) return

    if (d.dish) uid = store.replaceDish(uid, d.dish) || uid
    if (d.spice) uid = store.changeSpice(uid, d.spice) || uid
    if (d.note !== undefined) uid = store.setItemNote(uid, d.note) || uid

    this.refreshCart()

    const row = store.getCart().find(function (it) {
      return it.uid === uid
    })
    if (!row) {
      // 这一行被合并掉 / 删掉了，面板没必要继续留着
      this.closeEditor()
      return
    }
    this.setData({
      editorUid: uid,
      editorItem: { name: row.name, emoji: row.emoji, spice: row.spice, note: row.note },
    })
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  onNickInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  goBackMenu() {
    wx.switchTab({ url: '/pages/menu/menu' })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const cart = this.data.cart
    if (!cart.length) {
      ui.toast('还没选菜哦')
      return
    }
    const nickname = (this.data.nickname || '').trim() || '宝贝'
    store.setNickname(nickname)
    ui.haptic('medium')
    this.setData({ submitting: true })
    ui.showLoading('下单中…')
    try {
      const items = cart.map(function (it) {
        return {
          dishId: it.dishId,
          name: it.name,
          emoji: it.emoji,
          spice: it.spice || '不辣', // 用户选定的辣度
          note: it.note || '', // 这一道菜的单独备注
          qty: it.qty,
        }
      })
      await api.call('createOrder', {
        payload: {
          items: items,
          remark: (this.data.remark || '').trim(),
          order_by: nickname,
          // 刻意不传 status：新单固定是「待开做」，由服务端写死
          // （状态只由掌勺人推进 / 驳回，客户端不是状态的主人）
          dine_date: this.data.dineDate,
          dine_slot: this.data.dineSlot,
          // 忌口清单跟着订单一起送给掌勺人。
          // 提交这一刻现取 storage，而不是用 data 里的副本：storage 才是唯一真相，
          // 顺序上也不会出现「刚补了一条、data 还没来得及刷新就提交」的缝隙。
          avoids: store.getAvoids(),
        },
      })
      ui.hideLoading()
      store.clearCart()
      // 重置提交态，否则从订单页返回后按钮会一直是禁用的
      this.setData({ submitting: false })
      ui.toast('订单已送达厨房 🎉')
      // 用 switchTab 回订单页（orders 是 tabBar 页，会关掉本页）
      setTimeout(function () {
        wx.switchTab({ url: '/pages/orders/orders' })
      }, 800)
    } catch (err) {
      ui.hideLoading()
      console.error('[checkout] 下单失败', err)
      // 把真实错误透出来，避免只看到「下单没成功」却无从排查
      const msg = (err && (err.message || err.errMsg)) || '未知错误'
      ui.toast('下单没成功：' + msg)
      this.setData({ submitting: false })
    }
  },
})
