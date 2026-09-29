// 自定义 tabBar：按身份出不同的 tab ——
//   干饭人：点单 / 我的订单 / 我的资料（只管点，不掌勺）
//   掌勺人：待做 / 菜单 / 订单 / 我的资料（菜单 = 加菜 / 改菜 / 下架，看得到但点不了单）
// 官方 custom-tab-bar 约定：tab 页在 onShow 里 getTabBar().setData({ selected }) 同步选中态
const store = require('../utils/store')

const TABS = {
  orderer: [
    { key: 'menu', path: '/pages/menu/menu', text: '点单', emoji: '🍽️' },
    { key: 'orders', path: '/pages/orders/orders', text: '我的订单', emoji: '📋' },
    { key: 'profile', path: '/pages/profile/profile', text: '我的资料', emoji: '💕' },
  ],
  cook: [
    { key: 'todo', path: '/pages/todo/todo', text: '待做', emoji: '🍳' },
    { key: 'menu', path: '/pages/menu/menu', text: '菜单', emoji: '📖' },
    { key: 'orders', path: '/pages/orders/orders', text: '订单', emoji: '📋' },
    { key: 'profile', path: '/pages/profile/profile', text: '我的资料', emoji: '💕' },
  ],
}

Component({
  data: {
    role: '',
    tabs: [],
    // 当前选中的 tab key，由各 tab 页 onShow 同步进来
    selected: '',
  },

  lifetimes: {
    attached() {
      this.refresh()
    },
  },

  pageLifetimes: {
    // 页面每次显示都重算一遍：身份可能在「我的」页里切换过
    show() {
      this.refresh()
    },
  },

  methods: {
    refresh() {
      const role = store.getRole() || 'orderer'
      const tabs = TABS[role] || TABS.orderer
      this.setData({ role: role, tabs: tabs })
    },

    onTap(e) {
      const path = e.currentTarget.dataset.path
      if (!path) return
      wx.switchTab({ url: path })
    },
  },
})
