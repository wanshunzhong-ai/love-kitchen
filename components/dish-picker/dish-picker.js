/**
 * 选菜弹层（加菜 / 换菜）
 *
 * 抽出来的原因：pages/order-edit 的「＋ 从菜单加菜」与 components/dish-editor 的
 * 「🔄 换一道菜」是同一个弹层写了两遍 —— 加载菜单、分类过滤、空态、列表行
 * 全各来一套（.sheet-* / .pick-* vs .de-cat / .de-list / .de-pick-*）。
 * 现在只有这一份，两个入口都改用它。
 *
 * 组件自己负责「取菜单 + 分类 + 搜索」，因为这三件事在两处完全一样；
 * 但**选完之后干什么由页面决定** —— 只抛 `pick` 事件，不关闭自己：
 *   · 编辑订单页要多选几道，选完继续开着；
 *   · 改菜面板是「换一道」，选完要收起并回到编辑态。
 * 关闭时机交给调用方（调 close 事件时把 visible 置 false）。
 *
 * properties:
 *   visible   是否显示（调用方用 wx:if 或属性控制都行；为 true 时首次自动拉菜单）
 *   title     头部标题
 *   emptyText 该分类下没有菜时的文案
 *   backText  有值时头部右侧出「← {backText}」而不是「✕」——
 *             用于「换菜」这种「关掉是回上一层，不是关整个面板」的场景；
 *             两种都抛同一个 `close` 事件，具体回到哪里由调用方决定
 * events:
 *   pick  detail { dish }  选中了某道菜
 *   close 请求关闭
 */
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const dishSearch = require('../../utils/dish-search')
const paging = require('../../utils/paging')
const { CATEGORIES, DEFAULT_SPICE } = require('../../utils/constants')

const ALL = { key: dishSearch.ALL, emoji: '📜' }

Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '加菜' },
    emptyText: { type: String, value: '这个分类下还没有菜' },
    backText: { type: String, value: '' },
  },

  data: {
    categories: [ALL].concat(CATEGORIES),
    activeCategory: dishSearch.ALL,
    allDishes: [],
    // dishes = 筛选后的**完整**列表；真正渲染的是它的前 shownCount 条
    // （分页，见 utils/paging.js —— 三百多道菜全量渲染会让弹层滚动发涩）
    dishes: [],
    visibleDishes: [],
    shownCount: 0,
    hasMore: false,
    loading: false,
    // 模板里「没填辣度就显示默认档」用得到（模板没法 require 常量）
    defaultSpice: DEFAULT_SPICE,
    // 搜索（与菜单页同一套规则，见 utils/dish-search.js）
    keyword: '',
    searchFocus: false,
  },

  observers: {
    // 第一次显示时才拉菜单；关掉时把搜索清干净（下次打开带着上次的关键词很困惑），
    // 但**保留分类** —— 用户上次看到哪一档，回来还在那一档。
    visible: function (v) {
      if (v) {
        this.ensureDishes()
      } else {
        this.cancelDebounce()
        if (this.data.keyword || this.data.searchFocus) {
          this.setData({ keyword: '', searchFocus: false })
        }
      }
    },
  },

  lifetimes: {
    // property observer 在部分基础库的初始化时序里不保证触发，
    // 这里再兜一次：组件一挂上就显示（dish-editor 的换菜态就是这么用的），
    // 也要把菜单拉起来。
    attached: function () {
      if (this.properties.visible) this.ensureDishes()
    },
    detached: function () {
      this.cancelDebounce()
    },
  },

  methods: {
    // ---------- 菜单数据 ----------

    ensureDishes: function () {
      if (this.data.allDishes.length) {
        this.applyFilter()
        return
      }
      // attached 与 observer 可能先后各来一次，别发两遍请求
      if (this._loading) return
      this._loading = true
      var self = this
      this.setData({ loading: true })
      api
        .call('listDishes')
        .then(function (res) {
          self._loading = false
          // 补一个统一的 id（云开发主键是 _id）—— wxml 的 wx:key 与点击回查都用它
          var list = ((res && res.dishes) || []).map(function (d) {
            return Object.assign({}, d, { id: d._id || d.id })
          })
          self.setData({ allDishes: list, loading: false })
          self.applyFilter()
        })
        .catch(function (err) {
          self._loading = false
          console.error('[dish-picker] 菜单加载失败', err)
          self.setData({ loading: false })
          ui.toast('菜单没加载出来，稍后再试')
        })
    },

    // ---------- 分类 + 搜索 ----------

    onTapCategory: function (e) {
      // 切分类是要立刻看到结果的，不能被上一次输入的防抖拖住
      this.cancelDebounce()
      this.setData({ activeCategory: e.currentTarget.dataset.cat })
      this.applyFilter()
    },

    // keyword 立刻 setData（输入框是受控的，慢一拍光标会跳到末尾），
    // 只有「重新过滤」这件事延后 200ms
    onSearchInput: function (e) {
      this.setData({ keyword: e.detail.value })
      this.scheduleFilter()
    },

    scheduleFilter: function () {
      this.cancelDebounce()
      var self = this
      this._timer = setTimeout(function () {
        self._timer = null
        self.applyFilter()
      }, dishSearch.DEBOUNCE)
    },

    cancelDebounce: function () {
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
    },

    onSearchFocus: function () {
      this.setData({ searchFocus: true })
    },

    onSearchBlur: function () {
      this.setData({ searchFocus: false })
    },

    clearSearch: function () {
      this.cancelDebounce()
      this.setData({ keyword: '' })
      this.applyFilter()
    },

    /** 分类 + 关键词一起过，规则在 utils/dish-search.js（与菜单页同一份） */
    applyFilter: function () {
      var list = dishSearch.filterBy(this.data.allDishes, this.data.activeCategory, this.data.keyword)
      this.setData({ dishes: list })
      // 筛选结果变了 → 回到第一页
      this.resetPaging(list)
    },

    /** 回到第一页：首屏只渲染一页的量（见 utils/paging.js） */
    resetPaging: function (list) {
      var total = (list || []).length
      var shown = paging.initial(total)
      this.setData({
        shownCount: shown,
        visibleDishes: paging.slice(list, shown),
        hasMore: paging.hasMore(shown, total),
      })
    },

    /** 弹层里的列表滚到底 → 再放一页（scroll-view 的 bindscrolltolower） */
    onReachLower: function () {
      var list = this.data.dishes
      if (!paging.hasMore(this.data.shownCount, list.length)) return
      var shown = paging.grow(this.data.shownCount, list.length)
      this.setData({
        shownCount: shown,
        visibleDishes: paging.slice(list, shown),
        hasMore: paging.hasMore(shown, list.length),
      })
    },

    // ---------- 选中 / 关闭 ----------

    onPick: function (e) {
      // 按 id 回查而不是按下标：弹层里的列表会因搜索 / 分页变化，
      // 下标在「渲染」与「点击」之间可能已经指向别的菜
      var id = e.currentTarget.dataset.id
      var dish = this.data.dishes.find(function (d) {
        return String(d.id) === String(id)
      })
      if (!dish) return
      this.triggerEvent('pick', { dish: dish })
    },

    onClose: function () {
      this.triggerEvent('close')
    },

    // 弹层内容区不穿透关闭
    noop: function () {},
  },
})
