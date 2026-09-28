// 加菜 / 编辑菜品页：新增、修改、下架菜品
const api = require('../../utils/api')
const ui = require('../../utils/ui')
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
        ui.toast('这道菜不存在了')
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
      ui.toast('网络开小差了')
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
      ui.toast('先给菜起个名字吧')
      return
    }
    this.setData({ saving: true })
    ui.showLoading('保存中…')
    const payload = {
      name: name,
      category: this.data.category,
      emoji: this.data.emoji,
      spice: this.data.spice || '不辣',
      description: (this.data.description || '').trim(),
    }
    try {
      await api.call('saveDish', { id: this.data.id, payload: payload })
      ui.hideLoading()
      ui.toast(this.data.id ? '改好了 ✓' : '上新啦 ✓')
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
    } catch (err) {
      ui.hideLoading()
      console.error('[dish-edit] 保存失败', err)
      ui.toast('没保存成功，再试一次')
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
            ui.toast('没删掉，再试一次')
            return
          }
          ui.toast('已下架')
          setTimeout(function () {
            wx.navigateBack()
          }, 800)
        } catch (err) {
          console.error('[dish-edit] 下架菜品失败', err)
          ui.toast('网络开小差了，稍后再试')
        }
      },
    })
  },
})
