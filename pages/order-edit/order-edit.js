// 编辑订单页：改菜品、逐道改辣度 / 备注 / 换菜、从菜单加菜、选用餐时间、改备注、改点菜人、改状态，或整单删除
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
const { CATEGORIES, ORDER_STATUS_OPTIONS, SPICE_LEVELS } = require('../../utils/constants')

/** 订单内条目的唯一键：同一道菜的不同辣度算两条 */
function itemKey(it) {
  return String(it.dishId != null ? it.dishId : it.name) + '|' + (it.spice || '不辣')
}

/** 辣度 → 档位（0~3），用于配色 */
function spiceIdxOf(spice) {
  const hit = SPICE_LEVELS.find(function (s) {
    return s.key === spice
  })
  return hit ? hit.level : 0
}

/**
 * 把某个条目的字段改掉，并处理「改完撞上已有条目」的情况。
 * 撞上时合并数量到目标条目（备注按「目标没有就继承来源」处理，别让用户白写）。
 * @returns {{ items: Array, key: string, found: boolean }} key 是改完后活下来那条
 */
function applyRowChange(items, key, patch) {
  const out = items.map(function (it) {
    return Object.assign({}, it)
  })
  const idx = out.findIndex(function (it) {
    return it.key === key
  })
  if (idx < 0) return { items: out, key: key, found: false }

  const row = out[idx]
  Object.assign(row, patch)
  row.spiceIdx = spiceIdxOf(row.spice)
  row.key = itemKey(row)

  const dupIdx = out.findIndex(function (it, i) {
    return i !== idx && it.key === row.key
  })
  if (dupIdx >= 0) {
    const dup = out[dupIdx]
    dup.qty += row.qty
    if (!dup.note && row.note) dup.note = row.note
    out.splice(idx, 1)
  }
  return { items: out, key: row.key, found: true }
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
    // 逐道菜修改面板（辣度 / 备注 / 换菜）
    editorOpen: false,
    editorKey: '',
    editorItem: null,
    // 用餐时间（与结算页同一套选项；老订单没存过则给默认值）
    dineDates: [],
    dineDate: '',
    dineSlots: [],
    dineSlot: '',
  },

  onLoad(options) {
    const id = options && options.id ? String(options.id) : ''
    if (!id) {
      ui.toast('订单不存在')
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
      return
    }
    this.setData({ id: id })
    this.loadOrder(id)
  },

  // 给每条补 key / spiceIdx / note，供 wxml 使用
  decorate(items) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      const spice = it.spice || '不辣'
      const row = {
        dishId: it.dishId,
        name: it.name,
        emoji: it.emoji || '🍴',
        spice: spice,
        spiceIdx: spiceIdxOf(spice),
        note: it.note || '',
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
        ui.toast('这单不存在了')
        setTimeout(function () {
          wx.navigateBack()
        }, 800)
        return
      }
      const items = this.decorate(order.items)
      const now = new Date()
      const dates = dine.buildDateOptions(now)
      // 老订单没存过用餐时间 → 默认今天 + 当前时段；
      // 存过但已超出可选范围（比如过期日期）→ 也回落到默认
      const savedDate = order.dine_date || ''
      const dateValid = dates.some(function (d) {
        return d.value === savedDate
      })
      const date = dateValid ? savedDate : dates[0].value
      const slots = dine.buildSlotOptions(now, date)
      const savedSlot = order.dine_slot || ''
      const slotHit = slots.find(function (s) {
        return s.key === savedSlot
      })
      const slot = slotHit && !slotHit.disabled ? savedSlot : dine.defaultSlot(now, date)
      this.setData({
        items: items,
        remark: order.remark || '',
        orderBy: order.order_by || '',
        status: order.status || 'pending',
        totalCount: this.countOf(items),
        dineDates: dates,
        dineDate: date,
        dineSlots: slots,
        dineSlot: slot,
        loading: false,
      })
    } catch (err) {
      console.error('[order-edit] 加载订单失败', err)
      ui.toast('网络开小差了')
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

  // ---------- 用餐时间 ----------

  onPickDineDate(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.dineDate) return
    const now = new Date()
    this.setData({
      dineDate: value,
      dineSlots: dine.buildSlotOptions(now, value),
      dineSlot: dine.defaultSlot(now, value),
    })
  },

  onPickDineSlot(e) {
    const key = e.currentTarget.dataset.key
    const hit = this.data.dineSlots.find(function (s) {
      return s.key === key
    })
    if (!hit || hit.disabled) return
    this.setData({ dineSlot: key })
  },

  // ---------- 菜品行 ----------

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
    if (this.data.editorOpen && this.data.editorKey === key) this.closeEditor()
    this.setData({ items: items, totalCount: this.countOf(items) })
  },

  // 列表里直接改辣度
  onTapSpice(e) {
    const key = e.currentTarget.dataset.key
    const spice = e.currentTarget.dataset.spice
    const r = applyRowChange(this.data.items, key, { spice: spice })
    if (!r.found) return
    this.setData({ items: r.items, totalCount: this.countOf(r.items) })
    // 合并到别条时，面板要跟着换到活下来那条
    if (this.data.editorOpen && this.data.editorKey === key) {
      this.setData({ editorKey: r.key })
    }
  },

  // ---------- 逐道菜修改面板 ----------

  openEditor(e) {
    const key = e.currentTarget.dataset.key
    const row = this.data.items.find(function (it) {
      return it.key === key
    })
    if (!row) return
    this.setData({
      editorOpen: true,
      editorKey: key,
      editorItem: { name: row.name, emoji: row.emoji, spice: row.spice, note: row.note },
    })
  },

  closeEditor() {
    this.setData({ editorOpen: false, editorKey: '', editorItem: null })
  },

  // 面板里的改动落到这一单的条目上（改辣度 / 换菜可能触发合并，key 会变）
  onEditorChange(e) {
    const d = e.detail || {}
    let key = this.data.editorKey
    if (!key) return

    let items = this.data.items
    let found = true

    if (d.dish) {
      const r = applyRowChange(items, key, {
        dishId: d.dish.dishId,
        name: d.dish.name,
        emoji: d.dish.emoji,
        spice: d.dish.spice,
      })
      items = r.items
      key = r.key
      found = r.found
    }
    if (found && d.spice) {
      const r = applyRowChange(items, key, { spice: d.spice })
      items = r.items
      key = r.key
      found = r.found
    }
    if (found && d.note !== undefined) {
      const r = applyRowChange(items, key, { note: d.note })
      items = r.items
      key = r.key
      found = r.found
    }

    if (!found) {
      this.closeEditor()
      return
    }

    const row = items.find(function (it) {
      return it.key === key
    })
    this.setData({
      items: items,
      totalCount: this.countOf(items),
      editorKey: key,
      editorItem: row ? { name: row.name, emoji: row.emoji, spice: row.spice, note: row.note } : null,
    })
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
      ui.toast('菜单没加载出来，稍后再试')
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
      spiceIdx: spiceIdxOf(spice),
      note: '',
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
    ui.toast('已加入这一单（' + spice + '）')
  },

  // ---------- 保存 / 删除 ----------

  async onSave() {
    if (this.data.saving) return
    if (!this.data.items.length) {
      ui.toast('这一单至少要留一道菜')
      return
    }
    this.setData({ saving: true })
    ui.showLoading('保存中…')
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
              note: it.note || '', // 逐道菜的备注必须带上，否则保存一次就丢了
              qty: it.qty,
            }
          }),
          remark: (this.data.remark || '').trim(),
          order_by: (this.data.orderBy || '').trim() || '宝贝',
          status: this.data.status,
          dine_date: this.data.dineDate,
          dine_slot: this.data.dineSlot,
        },
      })
      ui.hideLoading()
      if (!res.updated) {
        ui.toast('没保存成功，再试一次')
        this.setData({ saving: false })
        return
      }
      ui.toast('改好了 ✓')
      setTimeout(function () {
        wx.navigateBack()
      }, 800)
    } catch (err) {
      ui.hideLoading()
      console.error('[order-edit] 保存订单失败', err)
      ui.toast('没保存成功，再试一次')
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
        ui.showLoading('删除中…')
        try {
          const r = await api.call('deleteOrder', { id: id })
          ui.hideLoading()
          if (!r.removed) {
            ui.toast('没删掉，再试一次')
            return
          }
          ui.toast('已删除')
          setTimeout(function () {
            wx.navigateBack()
          }, 800)
        } catch (err) {
          ui.hideLoading()
          console.error('[order-edit] 删除订单失败', err)
          ui.toast('网络开小差了，稍后再试')
        }
      },
    })
  },
})
