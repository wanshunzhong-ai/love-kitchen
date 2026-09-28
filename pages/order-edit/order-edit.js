// 编辑订单页：改菜品、改每道菜的辣度、改备注、改点菜人、改状态，或整单删除
const api = require('../../utils/api')
const { CATEGORIES, ORDER_STATUS_OPTIONS, SPICE_LEVELS } = require('../../utils/constants')

/** 订单内条目的唯一键：同一道菜的不同辣度算两条 */
function itemKey(it) {
  return String(it.dishId != null ? it.dishId : it.name) + '|' + (it.spice || '不辣')
}

Page({
  data: {
    id: null,
    items: [],
    remark: '',
    orderBy: '',
    status: 'pending',
    statusOptions: ORDER_STATUS_OPTIONS,
    spiceLevels: SPICE_LEVELS,
    categories: [{ key: '全部', emoji: '📜' }].concat(CATEGORIES),
    activeCategory: '全部',
    allDishes: [],
    pickerDishes: [],
    pickerOpen: false,
    pickerLoading: false,
    totalCount: 0,
    loading: true,
    saving: false,
  },

  onLoad(options) {
    const id = options && options.id ? String(options.id) : ''
    if (!id) {
      wx.showToast({ title: '订单不存在', icon: 'none' })
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
      return
    }
    this.setData({ id: id })
    this.loadOrder(id)
  },

  // 给每条补 key / spiceIdx，供 wxml 使用
  decorate(items) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      const spice = it.spice || '不辣'
      const hit = SPICE_LEVELS.find(function (s) {
        return s.key === spice
      })
      const row = {
        dishId: it.dishId,
        name: it.name,
        emoji: it.emoji || '🍴',
        spice: spice,
        spiceIdx: hit ? hit.level : 0,
        qty: Number(it.qty) || 1,
      }
      row.key = itemKey(row)
      return row
    })
  },

  countOf(items) {
    return (items || []).reduce(function (sum, it) {
      return sum + (it.qty || 0)
    }, 0)
  },

  async loadOrder(id) {
    this.setData({ loading: true })
    try {
      const res = await api.call('getOrder', { id: id })
      const order = res.order
      if (!order) {
        wx.showToast({ title: '这单不存在了', icon: 'none' })
        setTimeout(function () {
          wx.navigateBack()
        }, 800)
        return
      }
      const items = this.decorate(order.items)
      this.setData({
        items: items,
        remark: order.remark || '',
        orderBy: order.order_by || '',
        status: order.status || 'pending',
        totalCount: this.countOf(items),
        loading: false,
      })
    } catch (err) {
      console.error('[order-edit] 加载订单失败', err)
      wx.showToast({ title: '网络开小差了', icon: 'none' })
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
    }
  },

  // ---------- 同步编辑 ----------

  onNickInput(e) {
    this.setData({ orderBy: e.detail.value })
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  onTapStatus(e) {
    this.setData({ status: e.currentTarget.dataset.status })
  },

  onQtyChange(e) {
    const key = e.currentTarget.dataset.key
    const delta = Number(e.currentTarget.dataset.delta)
    const items = this.data.items
      .map(function (it) {
        return it.key === key ? Object.assign({}, it, { qty: it.qty + delta }) : it
      })
      .filter(function (it) {
        return it.qty > 0
      })
    this.setData({ items: items, totalCount: this.countOf(items) })
  },

  onRemoveItem(e) {
    const key = e.currentTarget.dataset.key
    const items = this.data.items.filter(function (it) {
      return it.key !== key
    })
    this.setData({ items: items, totalCount: this.countOf(items) })
  },

  // 改某道菜的辣度；若改后与同单已有条目重复则合并数量
  onTapSpice(e) {
    const key = e.currentTarget.dataset.key
    const spice = e.currentTarget.dataset.spice

    const items = this.data.items.map(function (it) {
      return Object.assign({}, it)
    })
    const idx = items.findIndex(function (it) {
      return it.key === key
    })
    if (idx < 0) return

    const target = items[idx]
    target.spice = spice
    target.spiceIdx = (SPICE_LEVELS.find(function (s) {
      return s.key === spice
    }) || { level: 0 }).level
    target.key = itemKey(target)

    const dupIdx = items.findIndex(function (it, i) {
      return i !== idx && it.key === target.key
    })
    if (dupIdx >= 0) {
      items[dupIdx].qty += target.qty
      items.splice(idx, 1)
    }

    this.setData({ items: items, totalCount: this.countOf(items) })
  },

  // ---------- 从菜单加菜 ----------

  async openPicker() {
    this.setData({ pickerOpen: true })
    if (this.data.allDishes.length) {
      this.applyPickerFilter()
      return
    }
    this.setData({ pickerLoading: true })
    try {
      const res = await api.call('listDishes')
      const dishes = res.dishes || []
      this.setData({ allDishes: dishes, pickerLoading: false })
      this.applyPickerFilter()
    } catch (err) {
      console.error('[order-edit] 加载菜单失败', err)
      this.setData({ pickerLoading: false })
      wx.showToast({ title: '菜单没加载出来，稍后再试', icon: 'none' })
    }
  },

  closePicker() {
    this.setData({ pickerOpen: false })
  },

  // 弹层内容区不穿透关闭
  noop() {},

  onTapPickerCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.cat })
    this.applyPickerFilter()
  },

  applyPickerFilter() {
    const { allDishes, activeCategory } = this.data
    const pickerDishes =
      activeCategory === '全部'
        ? allDishes
        : allDishes.filter(function (d) {
            return d.category === activeCategory
          })
    this.setData({ pickerDishes: pickerDishes })
  },

  onPickDish(e) {
    const dish = this.data.pickerDishes[e.currentTarget.dataset.idx]
    if (!dish) return
    const spice = dish.spice || '不辣'

    const items = this.data.items.slice()
    const row = {
      dishId: dish._id || dish.id,
      name: dish.name,
      emoji: dish.emoji || '🍴',
      spice: spice,
      spiceIdx: (SPICE_LEVELS.find(function (s) {
        return s.key === spice
      }) || { level: 0 }).level,
      qty: 1,
    }
    row.key = itemKey(row)

    const found = items.find(function (it) {
      return it.key === row.key
    })
    if (found) {
      found.qty += 1
    } else {
      items.push(row)
    }

    this.setData({ items: items, totalCount: this.countOf(items) })
    wx.showToast({ title: '已加入这一单（' + spice + '）', icon: 'none' })
  },

  // ---------- 保存 / 删除 ----------

  async onSave() {
    if (this.data.saving) return
    if (!this.data.items.length) {
      wx.showToast({ title: '这一单至少要留一道菜', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      const res = await api.call('updateOrder', {
        id: this.data.id,
        payload: {
          items: this.data.items.map(function (it) {
            return {
              dishId: it.dishId,
              name: it.name,
              emoji: it.emoji,
              spice: it.spice,
              qty: it.qty,
            }
          }),
          remark: (this.data.remark || '').trim(),
          order_by: (this.data.orderBy || '').trim() || '宝贝',
          status: this.data.status,
        },
      })
      wx.hideLoading()
      if (!res.updated) {
        wx.showToast({ title: '没保存成功，再试一次', icon: 'none' })
        this.setData({ saving: false })
        return
      }
      wx.showToast({ title: '改好了 ✓', icon: 'none' })
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
    } catch (err) {
      wx.hideLoading()
      console.error('[order-edit] 保存订单失败', err)
      wx.showToast({ title: '没保存成功，再试一次', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  onDelete() {
    const id = this.data.id
    if (!id) return
    wx.showModal({
      title: '删掉这一单？',
      content: '「' + (this.data.orderBy || '宝贝') + '」的这单会被删掉，删了就找不回来了',
      confirmText: '删除',
      cancelText: '留着',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中…', mask: true })
        try {
          const r = await api.call('deleteOrder', { id: id })
          wx.hideLoading()
          if (!r.removed) {
            wx.showToast({ title: '没删掉，再试一次', icon: 'none' })
            return
          }
          wx.showToast({ title: '已删除', icon: 'none' })
          setTimeout(function () {
            wx.navigateBack()
          }, 800)
        } catch (err) {
          wx.hideLoading()
          console.error('[order-edit] 删除订单失败', err)
          wx.showToast({ title: '网络开小差了，稍后再试', icon: 'none' })
        }
      },
    })
  },
})
