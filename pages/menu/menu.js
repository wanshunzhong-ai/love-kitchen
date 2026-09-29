// 点菜页：菜单浏览 + 购物车 + 随机帮选
const api = require('../../utils/api')
const { CATEGORIES, SPICE_LEVELS } = require('../../utils/constants')
const store = require('../../utils/store')
const ui = require('../../utils/ui')

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
    // 辣度选择弹层
    spicePicker: {
      open: false,
      dish: null,
      selected: '不辣',
      levels: SPICE_LEVELS,
    },
  },

  onShow() {
    // 自定义 tabBar：同步选中态 + 按身份重算 tab 列表（做饭人没有点菜 tab）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 'menu' })
      this.getTabBar().refresh()
    }
    // 身份守卫：没选过身份 → 送去选择页
    const role = store.ensureRole()
    if (!role) return
    this.setData({
      role: role,
      roleInfo: store.getRoleInfo(),
      // 做饭人不点菜：＋ / 随机帮选 / 购物车栏都只给点餐人
      isCook: role === 'cook',
      cartCount: store.cartCount(),
    })
    this.loadDishes()
  },

  // 头像/身份胶囊：进「我的」tab（基本资料）
  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  // 点餐人的底栏只有「点菜 / 我的」：订单从这里进（看状态、改单、删单）
  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  async loadDishes() {
    this.setData({ loading: true, loadError: false })
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
      this.setData({ dishes: dishes, loading: false })
      this.applyFilter()
    } catch (err) {
      console.error('[menu] 菜单加载失败', err)
      this.setData({ loading: false, loadError: true })
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

    this.setData({ filteredDishes: list })
  },

  onTapCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.cat })
    this.applyFilter()
  },

  // 点「＋」→ 先让他选辣度（默认就是这道菜的推荐辣度）
  onAddTap(e) {
    // 做饭人不点菜（模板已隐藏＋，这里兜底）
    if (this.data.isCook) {
      ui.toast('做饭人不点菜哦，等TA来下单 💕')
      return
    }
    const dish = this.data.filteredDishes[e.currentTarget.dataset.idx]
    if (!dish) return
    this.openSpicePicker(dish)
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
  },

  closeSpicePicker() {
    this.setData({ 'spicePicker.open': false })
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
      ui.toast('做饭人不点菜哦，等TA来下单 💕')
      return
    }
    store.addToCart(dish, selected)
    this.setData({
      cartCount: store.cartCount(),
      'spicePicker.open': false,
    })
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

  goCart() {
    if (this.data.isCook) return
    if (this.data.cartCount <= 0) return
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },

  // 「今天吃什么」随机帮选（点菜功能，只给点餐人）
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
