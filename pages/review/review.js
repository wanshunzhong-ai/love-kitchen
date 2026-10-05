// 订单评价页：干饭人对「已上菜」订单里的每一道菜逐条打分
//
// 交互约定（和这个项目的其他页面保持一致）：
//   · 一菜一卡：星级必填、快捷标签最多 3 个、一句话最多 40 字；
//   · 改动只存在本地草稿，点「存下这一条」才真正写云端 —— 评价是表达，
//     不该点一下星就自动提交（手滑一次就发出去了，撤不回）；
//   · 已评过的菜草稿从已存评价初始化，「改一改再存」= 更新同一条。
//
// 权限：只有干饭人能进来打分；掌勺人打开同一页是只读的（看 TA 的评价），
//       服务端也会拦「订单还没上菜」的情况，不指望前端自觉。
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const store = require('../../utils/store')
const dine = require('../../utils/dine')
const review = require('../../utils/review')
const live = require('../../utils/live')
const { spiceInfo } = require('../../utils/constants')
const { formatTime } = require('../../utils/format')

/** 草稿与已存评价是否一致（决定「存下」按钮亮不亮） */
function sameDraft(draft, saved) {
  const a = {
    rating: review.normalizeRating(draft.rating),
    tags: review.normalizeTags(draft.tags),
    text: review.normalizeText(draft.text),
  }
  const b = saved
    ? {
        rating: review.normalizeRating(saved.rating),
        tags: review.normalizeTags(saved.tags),
        text: review.normalizeText(saved.text),
      }
    : { rating: 0, tags: [], text: '' }
  return a.rating === b.rating && a.text === b.text && a.tags.join('|') === b.tags.join('|')
}

Page({
  data: {
    id: '',
    loading: true,
    loadError: false,
    // 订单信息
    orderBy: '',
    statusText: '',
    dineText: '',
    timeText: '',
    remark: '',
    // 逐道菜：{ key, name, emoji, spice, spiceIdx, qty, note, draft, dirty, computed 状态 }
    items: [],
    // 汇总：已评几道 / 共几道 / 平均分
    summary: { total: 0, rated: 0, avgText: '', allDone: false, any: false },
    // 常量给 wxml 用
    starSlots: review.STAR_SLOTS,
    allTags: review.REVIEW_TAGS,
    textMax: review.REVIEW_TEXT_MAX,
    tagsMax: review.REVIEW_TAGS_MAX,
    ratingLabels: review.RATING_LABELS,
    // 身份：掌勺人打开 = 只读
    readonly: false,
    savingKey: '',
  },

  onLoad(options) {
    const id = options && options.id ? String(options.id) : ''
    if (!id) {
      ui.toast('订单不存在')
      setTimeout(function () {
        wx.navigateBack()
      }, ui.TOAST_DURATION)
      return
    }
    // 身份守卫：没选过身份先送去选择页
    const role = store.ensureRole()
    if (!role) return
    this.setData({ id: id, readonly: role !== 'orderer' })
    this.loadOrder(id)
  },

  async loadOrder(id) {
    this.setData({ loading: true, loadError: false })
    try {
      const res = await api.call('getOrder', { id: id })
      const order = res.order
      if (!order) {
        ui.toast('这单不存在了')
        setTimeout(function () {
          wx.navigateBack()
        }, ui.TOAST_DURATION)
        return
      }
      const reviews = review.normalizeReviews(order.reviews)
      const items = review.decorateItems(order.items, reviews).map(function (it) {
        const draft = it.review
          ? { rating: it.review.rating, tags: it.review.tags.slice(), text: it.review.text }
          : { rating: 0, tags: [], text: '' }
        const info = spiceInfo(it.spice)
        return Object.assign({}, it, {
          spiceIdx: info.level,
          draft: draft,
          dirty: false,
          // 星级文案随草稿变，提前算好省得 wxml 里写逻辑
          draftLabel: review.ratingLabel(draft.rating),
          tagOn: {}, // { 标签文本: true } 供 wxml 判断选中态
        })
      })
      this.setData({
        items: items,
        orderBy: order.order_by || '宝贝',
        statusText: '已上菜',
        dineText: dine.formatDine(order.dine_date, order.dine_slot),
        timeText: formatTime(order.created_at),
        remark: order.remark || '',
        summary: review.summarize(order.items, reviews),
        loading: false,
      })
      this.refreshTags()
    } catch (err) {
      console.error('[review] 加载订单失败', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  // 加载失败后的重试（错误态上的按钮；下拉刷新也能达到同样效果）
  onRetry() {
    if (this.data.id) this.loadOrder(this.data.id)
  },

  // 标签选中态：wxml 里不能直接 indexOf 数组，这里预先摊平成对象
  refreshTags() {
    const patch = {}
    this.data.items.forEach(function (it, i) {
      const on = {}
      it.draft.tags.forEach(function (t) {
        on[t] = true
      })
      patch['items[' + i + '].tagOn'] = on
    })
    if (Object.keys(patch).length) this.setData(patch)
  },

  idxOfKey(key) {
    return this.data.items.findIndex(function (it) {
      return it.key === key
    })
  },

  // ---------- 编辑草稿（只走路径 setData，避免整列表重渲染把输入框光标顶飞） ----------

  onTapStar(e) {
    if (this.data.readonly) return
    const key = e.currentTarget.dataset.key
    const star = Number(e.currentTarget.dataset.star) || 0
    const i = this.idxOfKey(key)
    if (i < 0) return
    const it = this.data.items[i]
    // 再点同一颗星 = 取消（回到「还没评」），免得选错了退不回去
    const next = it.draft.rating === star ? 0 : star
    ui.haptic('light')
    const draft = Object.assign({}, it.draft, { rating: next })
    this.setData({
      ['items[' + i + '].draft']: draft,
      ['items[' + i + '].draftLabel']: review.ratingLabel(next),
      ['items[' + i + '].dirty']: !sameDraft(draft, it.review),
    })
  },

  onToggleTag(e) {
    if (this.data.readonly) return
    const key = e.currentTarget.dataset.key
    const text = e.currentTarget.dataset.text
    const i = this.idxOfKey(key)
    if (i < 0) return
    const it = this.data.items[i]
    const cur = it.draft.tags.slice()
    const at = cur.indexOf(text)

    if (at >= 0) {
      cur.splice(at, 1)
    } else {
      if (cur.length >= this.data.tagsMax) {
        ui.toast('最多选 ' + this.data.tagsMax + ' 个标签哦')
        return
      }
      cur.push(text)
    }

    const draft = Object.assign({}, it.draft, { tags: cur })
    const on = {}
    cur.forEach(function (t) {
      on[t] = true
    })
    this.setData({
      ['items[' + i + '].draft']: draft,
      ['items[' + i + '].tagOn']: on,
      ['items[' + i + '].dirty']: !sameDraft(draft, it.review),
    })
  },

  onTextInput(e) {
    if (this.data.readonly) return
    const key = e.currentTarget.dataset.key
    const i = this.idxOfKey(key)
    if (i < 0) return
    const it = this.data.items[i]
    const text = review.normalizeText(e.detail.value)
    const draft = Object.assign({}, it.draft, { text: text })
    this.setData({
      ['items[' + i + '].draft']: draft,
      ['items[' + i + '].dirty']: !sameDraft(draft, it.review),
    })
  },

  // ---------- 存 / 撤 ----------

  onSave(e) {
    const key = e.currentTarget.dataset.key
    const i = this.idxOfKey(key)
    if (i < 0) return
    const it = this.data.items[i]

    if (!it.draft.rating) {
      ui.toast('先给这道菜点个星吧 ⭐')
      return
    }
    this.submit(it, {
      rating: it.draft.rating,
      tags: it.draft.tags,
      text: it.draft.text,
    })
  },

  // 撤销这一条：确实想清空时才点，所以走二次确认
  onClear(e) {
    const key = e.currentTarget.dataset.key
    const i = this.idxOfKey(key)
    if (i < 0) return
    const it = this.data.items[i]
    if (!it.review) return
    const self = this
    wx.showModal({
      title: '撤掉这道菜的评价？',
      content: '「' + it.name + '」的评价会被清空，可以重新评',
      confirmText: '撤掉',
      confirmColor: '#FF7A9E',
      cancelText: '留着',
      success: function (res) {
        if (res.confirm) self.submit(it, null)
      },
    })
  },

  async submit(item, payload) {
    if (this.data.savingKey) return
    this.setData({ savingKey: item.key })
    ui.showLoading(payload ? '存评价中…' : '撤销中…')
    try {
      const res = await api.call('saveReview', {
        id: this.data.id,
        key: item.key,
        review: payload
          ? {
              rating: payload.rating,
              tags: payload.tags,
              text: payload.text,
              by: store.getNickname() || '',
              at: new Date().toISOString(),
            }
          : null,
      })
      ui.hideLoading()
      const saved = review.reviewOf(res.reviews, item.key)
      const draft = saved
        ? { rating: saved.rating, tags: saved.tags.slice(), text: saved.text }
        : { rating: 0, tags: [], text: '' }
      const on = {}
      draft.tags.forEach(function (t) {
        on[t] = true
      })

      // 只改这一条，并把汇总重算一遍（顶部进度要跟着动）
      const items = this.data.items.map(function (it) {
        if (it.key !== item.key) return it
        return Object.assign({}, it, {
          review: saved,
          rated: !!saved,
          hasReview: !!(saved && (saved.text || saved.tags.length)),
          ratingLabel: saved ? review.ratingLabel(saved.rating) : '',
          draft: draft,
          tagOn: on,
          dirty: false,
        })
      })
      this.setData({
        items: items,
        summary: review.summarize(items, res.reviews),
        savingKey: '',
      })
      ui.toast(saved ? '记下啦，谢谢宝贝 😋' : '已撤掉')
      // 让 App 级轮询立刻补一轮：这样退回订单页时评价已经在那儿了，
      // 不用等下一次轮询（全上完菜时可能是 60 秒一档）
      live.refreshNow()
    } catch (err) {
      ui.hideLoading()
      console.error('[review] 保存评价失败', err)
      this.setData({ savingKey: '' })
      ui.toast((err && err.message) || '网络开小差了，稍后再试')
    }
  },

  onPullDownRefresh() {
    if (!this.data.id) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadOrder(this.data.id).finally(function () {
      wx.stopPullDownRefresh()
    })
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' })
  },
})
