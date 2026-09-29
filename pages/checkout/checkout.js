// 确认订单页：改数量、逐道改辣度 / 备注 / 换菜、选用餐时间、写备注、填点菜人，提交到云端
const api = require('../../utils/api')
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
const { SPICE_LEVELS } = require('../../utils/constants')

Page({
  data: {
    cart: [],
    totalCount: 0,
    remark: '',
    nickname: '',
    submitting: false,
    spiceLevels: SPICE_LEVELS,
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
    this.refreshCart()
    this.refreshDine()
  },

  // 每次进入都按「当前时刻」重建日期与时段：
  // 跨天 / 时段过期后，之前选的值可能已经不合法
  refreshDine() {
    const now = new Date()
    const dates = dine.buildDateOptions(now)
    let date = this.data.dineDate
    const stillValid = dates.some(function (d) {
      return d.value === date
    })
    if (!stillValid) date = dates[0].value
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
    this.setData({
      cart: store.getCart(),
      totalCount: store.cartCount(),
      nickname: store.getNickname(),
    })
  },

  // 数量加减：按行身份（uid）定位，同菜不同辣度互不影响
  onQtyChange(e) {
    const uid = e.currentTarget.dataset.uid
    const delta = Number(e.currentTarget.dataset.delta)
    store.changeQty(uid, delta)
    this.refreshCart()
  },

  onRemoveItem(e) {
    const uid = e.currentTarget.dataset.uid
    store.removeFromCart(uid)
    // 面板正开着这一行时，把它一起关掉
    if (this.data.editorOpen && this.data.editorUid === uid) this.closeEditor()
    this.refreshCart()
  },

  // 辣度：列表里点一下就能改（更细的修改在「改这道菜」面板里）
  onTapSpice(e) {
    const uid = e.currentTarget.dataset.uid
    const spice = e.currentTarget.dataset.spice
    const newUid = store.changeSpice(uid, spice)
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
          status: 'pending',
          dine_date: this.data.dineDate,
          dine_slot: this.data.dineSlot,
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
