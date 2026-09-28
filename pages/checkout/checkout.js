// 确认订单页：调整数量、写备注、填点菜人，提交到云端
const { cloud } = require('../../utils/cloud')
const store = require('../../utils/store')

Page({
  data: {
    cart: [],
    totalCount: 0,
    remark: '',
    nickname: '',
    submitting: false,
  },

  onShow() {
    const cart = store.getCart()
    this.setData({
      cart: cart,
      totalCount: store.cartCount(),
      nickname: store.getNickname(),
    })
  },

  onQtyChange(e) {
    const dishId = Number(e.currentTarget.dataset.id)
    const delta = Number(e.currentTarget.dataset.delta)
    const cart = store.changeQty(dishId, delta)
    this.setData({ cart: cart, totalCount: store.cartCount() })
  },

  onRemoveItem(e) {
    const dishId = Number(e.currentTarget.dataset.id)
    const cart = store.removeFromCart(dishId)
    this.setData({ cart: cart, totalCount: store.cartCount() })
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
        return { dishId: it.dishId, name: it.name, emoji: it.emoji, qty: it.qty }
      })
      const { error } = await cloud.database.from('orders').insert({
        items: items,
        remark: (this.data.remark || '').trim() || null,
        order_by: nickname,
        status: 'pending',
      })
      wx.hideLoading()
      if (error) throw error
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
