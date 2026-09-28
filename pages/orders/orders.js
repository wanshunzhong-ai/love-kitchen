// 订单页：两个人都能看到全部订单，并推进状态（待开做 → 开做中 → 已上菜）
const { cloud } = require('../../utils/cloud')
const { ORDER_STATUS, SPICE_LEVELS } = require('../../utils/constants')
const { formatTime } = require('../../utils/format')

Page({
  data: {
    orders: [],
    filteredOrders: [],
    filters: [
      { key: '全部', emoji: '📋' },
      { key: 'pending', emoji: '📝' },
      { key: 'cooking', emoji: '👩‍🍳' },
      { key: 'done', emoji: '🎉' },
    ],
    activeFilter: '全部',
    statusMap: ORDER_STATUS,
    loading: true,
    loadError: false,
  },

  onShow() {
    this.loadOrders()
  },

  async loadOrders() {
    this.setData({ loading: true, loadError: false })
    try {
      const { data, error } = await cloud.database
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      const orders = (data || []).map(function (o) {
        const items = (Array.isArray(o.items) ? o.items : []).map(function (it) {
          const hit = SPICE_LEVELS.find(function (s) {
            return s.key === it.spice
          })
          const level = hit ? hit.level : 0
          return Object.assign({}, it, {
            spiceIdx: level,
            spiceText: level > 0 ? '🌶️'.repeat(level) : '不辣',
          })
        })
        return Object.assign({}, o, { items: items, timeText: formatTime(o.created_at) })
      })
      this.setData({ orders: orders, loading: false })
      this.applyFilter()
    } catch (err) {
      console.error('[orders] 订单加载失败', err)
      this.setData({ loading: false, loadError: true })
    }
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

  // 推进状态：写入云端后本地同步，失败时明确提示
  async updateStatus(idx, nextStatus) {
    const order = this.data.orders[idx]
    if (!order) return
    wx.showLoading({ title: '处理中…', mask: true })
    try {
      const { data, error } = await cloud.database
        .from('orders')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', order.id)
        .select()
      wx.hideLoading()
      if (error) throw error
      if (!Array.isArray(data) || data.length === 0) {
        wx.showToast({ title: '没更新成功，再试一次', icon: 'none' })
        return
      }
      const orders = this.data.orders.map(function (o) {
        return o.id === order.id ? Object.assign({}, o, { status: nextStatus }) : o
      })
      this.setData({ orders: orders })
      this.applyFilter()
      wx.showToast({ title: ORDER_STATUS[nextStatus].text, icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      console.error('[orders] 状态更新失败', err)
      wx.showToast({ title: '网络开小差了，稍后再试', icon: 'none' })
    }
  },

  onStartCooking(e) {
    this.updateStatus(e.currentTarget.dataset.idx, 'cooking')
  },

  onFinishCooking(e) {
    this.updateStatus(e.currentTarget.dataset.idx, 'done')
  },

  // 只允许取消「待开做」的订单
  onCancel(e) {
    const idx = e.currentTarget.dataset.idx
    const order = this.data.orders[idx]
    if (!order) return
    wx.showModal({
      title: '取消这单？',
      content: '「' + (order.order_by || '宝贝') + '」的订单将被删掉',
      confirmText: '取消订单',
      cancelText: '手滑了',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const { data, error } = await cloud.database
            .from('orders')
            .delete()
            .eq('id', order.id)
            .select()
          if (error) throw error
          if (!Array.isArray(data) || data.length === 0) {
            wx.showToast({ title: '没删掉，再试一次', icon: 'none' })
            return
          }
          this.setData({
            orders: this.data.orders.filter(function (o) {
              return o.id !== order.id
            }),
          })
          this.applyFilter()
          wx.showToast({ title: '已取消', icon: 'none' })
        } catch (err) {
          console.error('[orders] 取消订单失败', err)
          wx.showToast({ title: '网络开小差了，稍后再试', icon: 'none' })
        }
      },
    })
  },

  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' })
  },

  onPullDownRefresh() {
    this.loadOrders().finally(function () {
      wx.stopPullDownRefresh()
    })
  },
})
