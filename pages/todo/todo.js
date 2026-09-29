// 待做页：做饭人的厨房看板
// 把还没上菜（pending / cooking）的订单按「用餐日期」分组，一眼看清每天要做哪些菜
// 状态推进（开始做 / 做好了）仍在订单页操作，这里只做清单展示 + 跳转
const api = require('../../utils/api')
const store = require('../../utils/store')
const dine = require('../../utils/dine')
const { ORDER_STATUS, SPICE_LEVELS } = require('../../utils/constants')
const { formatTime } = require('../../utils/format')

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 'YYYY-MM-DD' → 「今天 9/29」；解析不了就原样返回 */
function dateLabel(dateKey) {
  try {
    const d = new Date(dateKey + 'T00:00:00')
    if (!isNaN(d.getTime())) {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
      const label = diff === 0 ? '今天' : diff === 1 ? '明天' : WEEK_LABELS[d.getDay()]
      return label + ' ' + (d.getMonth() + 1) + '/' + d.getDate()
    }
  } catch (e) {
    // 保底用原始字符串
  }
  return dateKey
}

Page({
  data: {
    // 按日期分组：[{ key, dateText, orders: [...], orderCount, dishCount }]
    groups: [],
    totalDishes: 0,
    loading: true,
    loadError: false,
    statusMap: ORDER_STATUS,
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
    this.loadOrders()
  },

  async loadOrders() {
    this.setData({ loading: true, loadError: false })
    try {
      const res = await api.call('listOrders')
      const groups = this.groupByDate(res.orders || [])
      const totalDishes = groups.reduce(function (sum, g) {
        return sum + g.dishCount
      }, 0)
      this.setData({ groups: groups, totalDishes: totalDishes, loading: false })
    } catch (err) {
      console.error('[todo] 订单加载失败', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  // 按用餐日期分组：没填日期的（老订单）归到「尽快」组放最前；
  // 已上菜的（done）不在待做范围；组内按日期从近到远排
  groupByDate(orders) {
    const buckets = {}
    const asap = []
    orders.forEach(function (o) {
      if (o.status === 'done') return
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
      const order = Object.assign({}, o, {
        id: o._id || o.id,
        items: items,
        // 「周三 9/30 · 午餐」；老订单没填 → 「尽快」
        dineText: dine.formatDine(o.dine_date, o.dine_slot),
      })
      if (!order.dine_date) {
        asap.push(order)
        return
      }
      if (!buckets[order.dine_date]) buckets[order.dine_date] = []
      buckets[order.dine_date].push(order)
    })

    const keys = Object.keys(buckets).sort()
    const groups = []
    if (asap.length) {
      groups.push(this.packGroup('_asap', '尽快要做', asap))
    }
    keys.forEach(function (key) {
      groups.push(this.packGroup(key, dateLabel(key), buckets[key]))
    }, this)
    return groups
  },

  packGroup(key, dateText, orders) {
    const dishCount = orders.reduce(function (sum, o) {
      return (
        sum +
        o.items.reduce(function (s, it) {
          return s + (it.qty || 0)
        }, 0)
      )
    }, 0)
    return {
      key: key,
      dateText: dateText,
      orders: orders,
      orderCount: orders.length,
      dishCount: dishCount,
    }
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
