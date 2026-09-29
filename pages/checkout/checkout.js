// 确认订单页：调整数量、逐道改辣度、选用餐时间、写备注、填点菜人，提交到云端
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

  // 数量加减：按条目 key（菜 + 辣度）定位，同菜不同辣度互不影响
  onQtyChange(e) {
    const key = e.currentTarget.dataset.key
    const delta = Number(e.currentTarget.dataset.delta)
    store.changeQty(key, delta)
    this.refreshCart()
  },

  onRemoveItem(e) {
    store.removeFromCart(e.currentTarget.dataset.key)
    this.refreshCart()
  },

  // 逐道改辣度：同菜已有该辣度时会自动合并数量
  onTapSpice(e) {
    const key = e.currentTarget.dataset.key
    store.changeSpice(key, e.currentTarget.dataset.spice)
    this.refreshCart()
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
      // 用 navigateBack 回订单页（orders 是 tabBar 页，switchTab 会保留本页在栈里）
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
