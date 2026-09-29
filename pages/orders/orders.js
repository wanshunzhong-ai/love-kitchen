// 订单页：两个人都能看到全部订单，并推进状态（待开做 → 开做中 → 已上菜）
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
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
      const res = await api.call('listOrders')
      const orders = (res.orders || []).map(function (o) {
        const items = (Array.isArray(o.items) ? o.items : []).map(function (it) {
          const spice = it.spice || '不辣'
          const hit = SPICE_LEVELS.find(function (s) {
            return s.key === spice
          })
          const level = hit ? hit.level : 0
          return Object.assign({}, it, {
            // 同一道菜可能有多种辣度，key 必须带上辣度才唯一
            rowKey: String(it.name) + '|' + spice,
            spice: spice,
            spiceIdx: level,
            spiceText: level > 0 ? '🌶️'.repeat(level) : '不辣',
          })
        })
        return Object.assign({}, o, {
          id: o._id || o.id,
          items: items,
          timeText: formatTime(o.created_at),
          // 「周三 9/30 · 午餐」；老订单没填 → 「尽快」
          dineText: dine.formatDine(o.dine_date, o.dine_slot),
        })
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
  // 注意：找的是 filteredOrders（列表实际渲染的那份），
  //       否则「筛选后」索引会与 orders 对不上，改错单。
  async updateStatus(idx, nextStatus) {
    const order = this.data.filteredOrders[idx]
    if (!order) return
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
    } catch (err) {
      ui.hideLoading()
      console.error('[orders] 状态更新失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  onStartCooking(e) {
    this.updateStatus(e.currentTarget.dataset.idx, 'cooking')
  },

  onFinishCooking(e) {
    this.updateStatus(e.currentTarget.dataset.idx, 'done')
  },

  // 编辑这一单：改菜、改备注、改点菜人、改状态，或整单删除
  onEditOrder(e) {
    const order = this.data.filteredOrders[e.currentTarget.dataset.idx]
    if (!order) return
    wx.navigateTo({ url: '/pages/order-edit/order-edit?id=' + order.id })
  },

  // 删除整单：二次确认后从云端删除，再刷新列表
  onDeleteOrder(e) {
    const order = this.data.filteredOrders[e.currentTarget.dataset.idx]
    if (!order) return
    const self = this
    wx.showModal({
      title: '删掉这一单？',
      content: '删掉就找不回来了哦',
      confirmText: '删掉',
      confirmColor: '#FF7A9E',
      cancelText: '再想想',
      success: function (res) {
        if (res.confirm) self.doDeleteOrder(order)
      },
    })
  },

  async doDeleteOrder(order) {
    ui.showLoading('删除中…')
    try {
      const res = await api.call('deleteOrder', { id: order.id })
      ui.hideLoading()
      if (!res.removed) {
        ui.toast('没删掉，再试一次')
        return
      }
      // 本地同步移除，避免再拉一次接口
      const orders = this.data.orders.filter(function (o) {
        return o.id !== order.id
      })
      this.setData({ orders: orders })
      this.applyFilter()
      ui.toast('已删除')
    } catch (err) {
      ui.hideLoading()
      console.error('[orders] 删除订单失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
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
