// 确认订单页：调整数量、逐道改辣度、写备注、填点菜人，提交到云端
const api = require('../../utils/api')
const store = require('../../utils/store')
const { SPICE_LEVELS } = require('../../utils/constants')

Page({
  data: {
    cart: [],
    totalCount: 0,
    remark: '',
    nickname: '',
    submitting: false,
    spiceLevels: SPICE_LEVELS,
  },

  onShow() {
    this.refreshCart()
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
      wx.showToast({ title: '还没选菜哦', icon: 'none' })
      return
    }
    const nickname = (this.data.nickname || '').trim() || '宝贝'
    store.setNickname(nickname)
    this.setData({ submitting: true })
    wx.showLoading({ title: '下单中…', mask: true })
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
        },
      })
      wx.hideLoading()
      store.clearCart()
      wx.showToast({ title: '订单已送达厨房 🎉', icon: 'none' })
      setTimeout(function () {
        wx.switchTab({ url: '/pages/orders/orders' })
      }, 800)
    } catch (err) {
      wx.hideLoading()
      console.error('[checkout] 下单失败', err)
      wx.showToast({ title: '下单没成功，再试一次', icon: 'none' })
      this.setData({ submitting: false })
    }
  },
})
