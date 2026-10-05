// 菜单日志：看「干饭人对菜单做过哪些加 / 改 / 下架」
//
// 为什么需要这一页：菜品库存在各自手机本地（见 utils/dishes.js 顶部）——
// 干饭人在菜单页动了什么，掌勺人那边不但不会变，还完全不知道。
// 这份流水是唯一能把「TA 做过什么」传过去的通道（详见 utils/dish-logs.js）。
//
// 这是非 tab 页：按项目惯例不设身份门槛（两个身份都能进，由 store.getRole() 决定形态），
// 但**入口**只挂在掌勺人的菜单页上。
const api = require('../../utils/api')
const dishLogs = require('../../utils/dish-logs')
const store = require('../../utils/store')
const ui = require('../../utils/ui')
const { formatClock } = require('../../utils/format')
/** 给一条日志挂上可渲染的文案与时间（纯展示层加工，规则仍在 dish-logs.js 里） */
function decorate(log) {
  return Object.assign({}, log, {
    view: dishLogs.describe(log),
    timeText: formatClock(log.created_at),
  })
}

Page({
  data: {
    role: '',
    isCook: false,
    loading: true,
    loadError: false,
    // all = 全部；orderer = 只看干饭人动的（掌勺人最关心的那部分）
    filter: 'all',
    groups: [],
    total: 0,
    // 时间窗：默认只看最近 DEFAULT_DAYS 天（这张表只追加不删，见清单 C29）
    days: dishLogs.DEFAULT_DAYS,
    canExpand: dishLogs.DEFAULT_DAYS < dishLogs.DAYS_MAX,
    capped: false,
  },

  onShow() {
    const role = store.getRole() || ''
    this.setData({ role: role, isCook: role === 'cook' })
    this.load()
  },

  /**
   * 拉日志。stale-while-revalidate：手上已有列表就不闪 loading，
   * 请求回来静默换新（与菜单页同一套做法）。
   */
  async load() {
    if (this._loading) return
    this._loading = true
    const hasCache = this.data.groups.length > 0
    if (!hasCache) this.setData({ loading: true, loadError: false })

    try {
      // 只拉最近 days 天的（时间窗在服务端生效，不是拉全再本地裁）
      const res = await api.call('listDishLogs', { days: this.data.days })
      this._all = (res && res.logs ? res.logs : []).map(decorate)
      this.setData({
        loading: false,
        loadError: false,
        capped: !!(res && res.capped),
        canExpand: this.data.days < dishLogs.DAYS_MAX,
      })
      this.applyFilter()
    } catch (err) {
      console.error('[dish-logs] 加载失败', err)
      // 有缓存时静默失败（旧列表还能看），只在首屏给出错误态
      if (!hasCache) this.setData({ loading: false, loadError: true })
      else this.setData({ loading: false })
    } finally {
      this._loading = false
    }
  },

  applyFilter() {
    const all = this._all || []
    const list =
      this.data.filter === 'orderer'
        ? all.filter(function (l) {
            return l.by_role !== 'cook'
          })
        : all
    this.setData({ groups: dishLogs.groupByDay(list), total: list.length })
  },

  onFilterTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.filter) return
    this.setData({ filter: key })
    this.applyFilter()
  },

  onRetry() {
    ui.haptic('light')
    this.load()
  },

  /**
   * 看更早的：把时间窗 ×3 再拉一次（30 → 90 → 270 → 封顶 365）。
   * 不一次拉到头，是因为绝大多数时候只看最近的；窗口够用时不必付那份流量。
   */
  onExpand() {
    if (this.data.days >= dishLogs.DAYS_MAX) return
    ui.haptic('light')
    const next = Math.min(this.data.days * 3, dishLogs.DAYS_MAX)
    this.setData({ days: next })
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(function () {
      wx.stopPullDownRefresh()
    })
  },
})
