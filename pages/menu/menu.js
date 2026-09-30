// 菜单页：一页两用 ——
//   干饭人看它是「点单页」：浏览 / 搜索菜单、加购物车、随机帮选
//   掌勺人看它是「菜单管理页」：加菜 / 改菜 / 下架（底栏 tab 也叫「菜单」），但没有点单入口
//
// 排序：**掌勺人**的列表默认按「TA 点过的次数」排（utils/frequency.js）——
// 三百多道菜里一眼看到常点的，好备料；干饭人的「点单」页保持菜单原顺序，
// 免得他们熟悉的位置天天变。掌勺人可以点右上角的小胶囊切回默认顺序。
//
// 频率的数据不额外请求：App 级轮询（utils/live.js）本来就在拿订单，
// 这里订阅它就行；万一轮询还没跑起来，才自己拉一次 listOrders。
const api = require('../../utils/api')
const { CATEGORIES, SPICE_LEVELS } = require('../../utils/constants')
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const live = require('../../utils/live')
const freq = require('../../utils/frequency')

const ALL = { key: '全部', emoji: '📜' }

Page({
  data: {
    categories: [ALL].concat(CATEGORIES),
    activeCategory: '全部',
    dishes: [],
    filteredDishes: [],
    cartCount: 0,
    loading: true,
    loadError: false,
    // 搜索
    keyword: '',
    searchFocus: false,
    // 点菜频率（掌勺人专用排序）
    sortByFreq: true,
    freqReady: false,
    freqPicked: 0,
    freqTip: '',
    // 辣度选择弹层
    spicePicker: {
      open: false,
      dish: null,
      selected: '不辣',
      levels: SPICE_LEVELS,
    },
  },

  onShow() {
    // 自定义 tabBar：同步选中态 + 按身份重算 tab 列表
    // （干饭人的第二项是「点单」，掌勺人的是「菜单」——同一个 key、同一个页面，只是叫法不同）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 'menu' })
      this.getTabBar().refresh()
    }
    // 身份守卫：没选过身份 → 送去选择页
    const role = store.ensureRole()
    if (!role) return
    // 掌勺人进的是「菜单管理」（加菜 / 改菜 / 下架）
    wx.setNavigationBarTitle({ title: role === 'cook' ? '菜单管理' : '爱心小厨房' })
    this.setData({
      role: role,
      roleInfo: store.getRoleInfo(),
      // 掌勺人不点单：＋ / 随机帮选 / 购物车栏都只给干饭人
      isCook: role === 'cook',
      cartCount: store.cartCount(),
    })
    this.loadDishes()
    // 只有掌勺人的列表要按频率排 —— 干饭人那边连订单都不必读
    if (role === 'cook') {
      this.loadFrequency()
      this.watchOrders()
    }
  },

  onHide() {
    // 离开页面（切 tab / 跳走）时复位：弹层关掉、底栏收回来，
    // 否则下次回来 tabBar 会一直是隐藏的
    this.setTabBarHidden(false)
    if (this.data.spicePicker.open) this.setData({ 'spicePicker.open': false })
    // 退订：页面不在了就别再跟着轮询重排
    this.unwatchOrders()
  },

  // ---------- 点菜频率（掌勺人的排序依据） ----------

  /** 订阅 App 级订单快照：TA 点了新单，这边的顺序会自己更新 */
  watchOrders() {
    if (this._unsub) return
    const self = this
    this._onLive = function (d, orders) {
      // 只在订单真的变了时重排（d.any），否则每 15 秒的轮询都会动一次列表
      if (d && d.any && Array.isArray(orders)) self.applyFrequency(orders)
    }
    this._unsub = live.subscribe(this._onLive)
  },

  unwatchOrders() {
    if (this._unsub) {
      this._unsub()
      this._unsub = null
    }
  },

  /** 拿一份订单：优先用轮询已经拿到的快照，没有再自己拉（失败就静默按原顺序） */
  async loadFrequency() {
    if (!this.data.isCook) return
    const cached = live.hasData() ? live.currentOrders() : null
    if (cached && cached.length) {
      this.applyFrequency(cached)
      return
    }
    try {
      const res = await api.call('listOrders')
      this.applyFrequency((res && res.orders) || [])
    } catch (err) {
      console.error('[menu] 点菜频率加载失败', err)
    }
  },

  /**
   * 订单 → 频率 → 重新挂到菜单上。
   * 统计结果没变就直接 return：轮询每 15 秒来一轮，
   * 每轮都整表重排会让掌勺人正在看的列表自己往上跳。
   */
  applyFrequency(orders) {
    if (!this.data.isCook) return
    const map = freq.count(orders)
    const sig = freq.signature(map)
    if (sig === this._freqSig) return
    this._freqSig = sig
    this._freqMap = map
    const dishes = freq.attach(this.data.dishes, map)
    const picked = freq.pickedCount(dishes)
    this.setData({
      dishes: dishes,
      freqReady: true,
      freqPicked: picked,
      freqTip: picked > 0
        ? '按 TA 点过的次数排的，常点的在上面'
        : '还没有点单记录，先按菜单原来的顺序',
    })
    this.applyFilter()
  },

  // 切回默认顺序 / 再切回按常点排
  onToggleSort() {
    if (!this.data.isCook) return
    this.setData({ sortByFreq: !this.data.sortByFreq })
    this.applyFilter()
    ui.haptic('light')
  },

  // 头像/身份胶囊：进「我的」tab（基本资料）
  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  async loadDishes() {
    // stale-while-revalidate：手上已有菜单就别闪 loading 了——
    // 先让旧列表继续显示（滚动位置也保住），请求回来静默换新数据。
    // 只有首屏（一次都没加载过）才显示「正在摆盘…」占位。
    const hasCache = this.data.dishes.length > 0
    // 并发保护：onShow 与下拉刷新可能叠在一起，同屏只发一次
    if (this._loadingDishes) return
    this._loadingDishes = true
    if (!hasCache) this.setData({ loading: true, loadError: false })
    try {
      const res = await api.call('listDishes')
      const dishes = (res.dishes || []).map(function (d) {
        const hit = SPICE_LEVELS.find(function (s) {
          return s.key === d.spice
        })
        const level = hit ? hit.level : 0
        return Object.assign({}, d, {
          // 兼容旧的 dish.id 用法：云开发主键是 _id（字符串）
          id: d._id || d.id,
          spiceIdx: level,
          spiceText: level > 0 ? '🌶️'.repeat(level) : '不辣',
          // 预生成小写检索串，避免每次输入都重复 toLowerCase
          _hay: ((d.name || '') + ' ' + (d.description || '') + ' ' + (d.category || '')).toLowerCase(),
        })
      })
      // 挂上点菜频率（掌勺人排序要用）。注意：**保持菜单原顺序**，
      // 排序在 applyFilter 里做 —— 切回默认顺序时不用重新拉数据。
      this.setData({ dishes: freq.attach(dishes, this._freqMap || {}), loading: false })
      this.applyFilter()
    } catch (err) {
      console.error('[menu] 菜单加载失败', err)
      // 有缓存时静默失败（旧数据还能看），只在首屏给出错误态
      if (!hasCache) this.setData({ loadError: true })
      this.setData({ loading: false })
    } finally {
      this._loadingDishes = false
    }
  },

  // 搜索框输入
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  onSearchFocus() {
    this.setData({ searchFocus: true })
  },

  onSearchBlur() {
    this.setData({ searchFocus: false })
  },

  // 清空搜索
  clearSearch() {
    this.setData({ keyword: '' })
    this.applyFilter()
  },

  applyFilter() {
    const { dishes, activeCategory, keyword } = this.data

    let list =
      activeCategory === '全部'
        ? dishes
        : dishes.filter(function (d) {
            return d.category === activeCategory
          })

    // 关键词：菜名 / 介绍 / 分类 都参与匹配（多关键词用空格分隔，需全部命中）
    const kw = (keyword || '').trim().toLowerCase()
    if (kw) {
      const parts = kw.split(/\s+/).filter(function (p) {
        return p
      })
      list = list.filter(function (d) {
        return parts.every(function (p) {
          return d._hay.indexOf(p) >= 0
        })
      })
    }

    // 掌勺人：默认按「TA 点过的次数」排，常点的在上面（可点胶囊切回默认顺序）
    // 干饭人不排 —— 点单页的位置天天变反而难找
    if (this.data.isCook && this.data.sortByFreq) list = freq.sortByFrequency(list)

    this.setData({ filteredDishes: list })
  },

  onTapCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.cat })
    this.applyFilter()
  },

  // 点「＋」→ 先让他选辣度（默认就是这道菜的推荐辣度）
  onAddTap(e) {
    // 掌勺人不点单（模板已隐藏＋，这里兜底）
    if (this.data.isCook) {
      ui.toast('掌勺人不点单哦，等TA来点单 💕')
      return
    }
    const dish = this.data.filteredDishes[e.currentTarget.dataset.idx]
    if (!dish) return
    this.openSpicePicker(dish)
  },

  /**
   * 底部弹层打开时把 tabBar 藏起来。
   * 自定义 tabBar 是页面级原生层，页面里的 fixed + z-index 盖不住它，
   * 不藏的话弹层底部的「加入购物车」会被压掉一截。
   */
  setTabBarHidden(hidden) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setHidden(hidden)
    }
  },

  openSpicePicker(dish) {
    this.setData({
      spicePicker: {
        open: true,
        dish: dish,
        selected: dish.spice || '不辣', // 默认推荐辣度
        levels: SPICE_LEVELS,
      },
    })
    this.setTabBarHidden(true)
  },

  closeSpicePicker() {
    this.setData({ 'spicePicker.open': false })
    this.setTabBarHidden(false)
  },

  onPickSpice(e) {
    this.setData({ 'spicePicker.selected': e.currentTarget.dataset.spice })
  },

  // 弹层内容区不穿透关闭
  noop() {},

  // 确认加入（用弹层里选中的辣度）
  confirmAdd() {
    const { dish, selected } = this.data.spicePicker
    if (!dish) return
    if (this.data.isCook) {
      this.setData({ 'spicePicker.open': false })
      this.setTabBarHidden(false)
      ui.toast('掌勺人不点单哦，等TA来点单 💕')
      return
    }
    store.addToCart(dish, selected)
    this.setData({
      cartCount: store.cartCount(),
      'spicePicker.open': false,
    })
    this.setTabBarHidden(false)
    ui.haptic('light')
    ui.toast('已加入购物车', 'success')
  },

  // 点菜品卡片 → 编辑这道菜
  onDishTap(e) {
    const dish = this.data.filteredDishes[e.currentTarget.dataset.idx]
    if (!dish) return
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?id=' + dish.id })
  },

  goAddDish() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' })
  },

  // 批量加菜（CSV / 粘贴导入）。与「＋ 加菜」同一权限：两种身份都能维护菜单。
  goImportDishes() {
    wx.navigateTo({ url: '/pages/dish-import/dish-import' })
  },

  goCart() {
    if (this.data.isCook) return
    if (this.data.cartCount <= 0) return
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },

  // 「今天吃什么」随机帮选（点单功能，只给干饭人）
  onRandom() {
    if (this.data.isCook) return
    const dishes = this.data.dishes
    if (!dishes.length) {
      ui.toast('菜单还是空的，先加道菜吧')
      return
    }
    const dish = dishes[Math.floor(Math.random() * dishes.length)]
    wx.showModal({
      title: '今天吃「' + dish.name + '」！',
      content: dish.description || '纠结的时候，就交给命运吧～',
      confirmText: '就它了',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) {
          // 和「＋」一样，先让选辣度（默认推荐辣度）
          this.openSpicePicker(dish)
        }
      },
    })
  },

  onPullDownRefresh() {
    this.loadDishes().finally(function () {
      wx.stopPullDownRefresh()
    })
  },
})
