// 自定义 tabBar：按身份出不同的 tab ——
//   干饭人：点单 / 我的订单 / 我的资料（只管点，不掌勺）
//   掌勺人：待做 / 菜单 / 订单 / 我的资料（菜单 = 加菜 / 改菜 / 下架，看得到但点不了单）
// 官方 custom-tab-bar 约定：tab 页在 onShow 里 getTabBar().setData({ selected }) 同步选中态
//
// 角标（badge）：
//   待做 tab 显示「有几单等着开做」，我的订单 tab 显示「有几单正在做」。
//   数字来自 utils/live.js 最近一轮轮询的结果 —— 它是模块级共享的，
//   所以页面那边轮询一到新数据，这里 refresh() 一下就能看到新角标。
const store = require('../utils/store')
const live = require('../utils/live')

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
    // 页面打开底部弹层时置 true 让位（tabBar 是原生层，弹层盖不住它）
    hidden: false,
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
      const badges = live.badgeFor(role)
      const base = TABS[role] || TABS.orderer

      // 角标每轮轮询都会重算，但绝大多数时候没变。
      // 用签名挡掉「什么都没变」的 setData —— 15 秒一次的无谓渲染，攒起来也是功耗。
      let sig = role
      base.forEach(function (t) {
        sig += '|' + t.key + ':' + (badges[t.key] || '')
      })
      if (this._sig === sig) return
      this._sig = sig

      // TABS 是模块级常量，必须复制一份再挂角标，不能就地改（否则会越积越多）
      const tabs = base.map(function (t) {
        return { key: t.key, path: t.path, text: t.text, emoji: t.emoji, badge: badges[t.key] || '' }
      })
      this.setData({ role: role, tabs: tabs })
    },

    /**
     * 隐藏 / 显示底栏。页面里弹出底部浮层时调 setHidden(true) 让位，
     * 关闭时记得 setHidden(false) 收回来。
     */
    setHidden(hidden) {
      const next = !!hidden
      if (this.data.hidden !== next) this.setData({ hidden: next })
    },

    onTap(e) {
      const path = e.currentTarget.dataset.path
      if (!path) return
      wx.switchTab({ url: path })
    },
  },
})
