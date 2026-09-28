// 点菜页：菜单浏览 + 购物车 + 随机帮选
const { cloud } = require('../../utils/cloud')
const { CATEGORIES, SPICE_LEVELS } = require('../../utils/constants')
const store = require('../../utils/store')

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
  },

  onShow() {
    this.setData({ cartCount: store.cartCount() })
    this.loadDishes()
  },

  async loadDishes() {
    this.setData({ loading: true, loadError: false })
    try {
      const { data, error } = await cloud.database
        .from('dishes')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(200)
      if (error) throw error
      const dishes = (data || []).map(function (d) {
        const hit = SPICE_LEVELS.find(function (s) {
          return s.key === d.spice
        })
        const level = hit ? hit.level : 0
        return Object.assign({}, d, {
          spiceIdx: level,
          spiceText: level > 0 ? '🌶️'.repeat(level) : '不辣',
        })
      })
      this.setData({ dishes: dishes, loading: false })
      this.applyFilter()
    } catch (err) {
      console.error('[menu] 菜单加载失败', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  applyFilter() {
    const { dishes, activeCategory } = this.data
    const filteredDishes =
      activeCategory === '全部'
        ? dishes
        : dishes.filter(function (d) {
            return d.category === activeCategory
          })
    this.setData({ filteredDishes: filteredDishes })
  },

  onTapCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.cat })
    this.applyFilter()
  },

  onAddTap(e) {
    const dish = this.data.filteredDishes[e.currentTarget.dataset.idx]
    if (!dish) return
    store.addToCart(dish)
    this.setData({ cartCount: store.cartCount() })
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
    if (this.data.cartCount <= 0) return
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },

  // 「今天吃什么」随机帮选
  onRandom() {
    const dishes = this.data.dishes
    if (!dishes.length) {
      wx.showToast({ title: '菜单还是空的，先加道菜吧', icon: 'none' })
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
          store.addToCart(dish)
          this.setData({ cartCount: store.cartCount() })
          wx.showToast({ title: '已加入购物车', icon: 'success' })
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
