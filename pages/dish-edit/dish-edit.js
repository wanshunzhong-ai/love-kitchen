// 加菜 / 编辑菜品页：新增、修改、下架菜品
const api = require('../../utils/api')
const { CATEGORIES, DISH_EMOJIS, SPICE_LEVELS } = require('../../utils/constants')

Page({
  data: {
    id: null,
    name: '',
    category: '经典热菜',
    emoji: '🍗',
    spice: '不辣',
    description: '',
    categories: CATEGORIES,
    emojis: DISH_EMOJIS,
    spiceLevels: SPICE_LEVELS,
    saving: false,
    loading: false,
  },

  onLoad(options) {
    if (options && options.id) {
      // 云开发主键 _id 是字符串，不做 Number 转换
      this.setData({ id: String(options.id), loading: true })
      this.loadDish(String(options.id))
    }
  },

  async loadDish(id) {
    try {
      const res = await api.call('getDish', { id: id })
      const data = res.dish
      if (!data) {
        wx.showToast({ title: '这道菜不存在了', icon: 'none' })
        setTimeout(function () {
          wx.navigateBack()
        }, 800)
        return
      }
      this.setData({
        name: data.name,
        category: data.category,
        emoji: data.emoji,
        spice: data.spice || '不辣',
        description: data.description || '',
        loading: false,
      })
    } catch (err) {
      console.error('[dish-edit] 加载菜品失败', err)
      wx.showToast({ title: '网络开小差了', icon: 'none' })
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
    }
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value })
  },

  onTapEmoji(e) {
    this.setData({ emoji: e.currentTarget.dataset.emoji })
  },

  onTapCategory(e) {
    this.setData({ category: e.currentTarget.dataset.cat })
  },

  onTapSpice(e) {
    this.setData({ spice: e.currentTarget.dataset.spice })
  },

  async onSave() {
    if (this.data.saving) return
    const name = (this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '先给菜起个名字吧', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    const payload = {
      name: name,
      category: this.data.category,
      emoji: this.data.emoji,
      spice: this.data.spice || '不辣',
      description: (this.data.description || '').trim(),
    }
    try {
      await api.call('saveDish', { id: this.data.id, payload: payload })
      wx.hideLoading()
      wx.showToast({ title: this.data.id ? '改好了 ✓' : '上新啦 ✓', icon: 'none' })
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
    } catch (err) {
      wx.hideLoading()
      console.error('[dish-edit] 保存失败', err)
      wx.showToast({ title: '没保存成功，再试一次', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  onDelete() {
    if (!this.data.id) return
    const id = this.data.id
    wx.showModal({
      title: '把「' + (this.data.name || '这道菜') + '」下架？',
      content: '菜单里将不再显示这道菜',
      confirmText: '下架',
      cancelText: '留着',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await api.call('deleteDish', { id: id })
          if (!r.removed) {
            wx.showToast({ title: '没删掉，再试一次', icon: 'none' })
            return
          }
          wx.showToast({ title: '已下架', icon: 'none' })
          setTimeout(function () {
            wx.navigateBack()
          }, 800)
        } catch (err) {
          console.error('[dish-edit] 下架菜品失败', err)
          wx.showToast({ title: '网络开小差了，稍后再试', icon: 'none' })
        }
      },
    })
  },
})
