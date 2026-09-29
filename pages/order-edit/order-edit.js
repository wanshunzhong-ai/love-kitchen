// 编辑订单页：改菜品、逐道改辣度 / 备注 / 换菜、从菜单加菜、选用餐时间、改备注、改点菜人、改状态，或整单删除
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
const { CATEGORIES, ORDER_STATUS_OPTIONS, SPICE_LEVELS, spiceInfo, DISH_NOTE_MAX } = require('../../utils/constants')

/** 订单内条目的唯一键：同一道菜的不同辣度算两条 */
function itemKey(it) {
  return String(it.dishId != null ? it.dishId : it.name) + '|' + (it.spice || '不辣')
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
  const info = spiceInfo(row.spice)
  row.spiceIdx = info.level
  row.spiceLabel = info.label
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
    // 辣度平时只显示「当前选的那一档」；这一条是正在展开重选的那道菜
    spiceOpenKey: '',
    categories: [{ key: '全部', emoji: '📜' }].concat(CATEGORIES),
    activeCategory: '全部',
    allDishes: [],
    pickerDishes: [],
    pickerOpen: false,
    pickerLoading: false,
    totalCount: 0,
    loading: true,
    saving: false,
    // 已上菜 = 终态：本页退化成只读（只展示 + 删除），不能保存修改
    finalized: false,
    dineText: '',
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

  // 给每条补 key / spiceIdx / spiceLabel / note，供 wxml 使用
  decorate(items) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      const spice = it.spice || '不辣'
      const info = spiceInfo(spice)
      const row = {
        dishId: it.dishId,
        name: it.name,
        emoji: it.emoji || '🍴',
        spice: spice,
        spiceIdx: info.level,
        spiceLabel: info.label,
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
      const status = order.status || 'pending'
      this.setData({
        items: items,
        remark: order.remark || '',
        orderBy: order.order_by || '',
        status: status,
        finalized: status === 'done',
        totalCount: this.countOf(items),
        // 「周三 10/1 · 午餐」；老订单没填 → 「尽快」
        dineText: dine.formatDine(order.dine_date, order.dine_slot),
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
    // 正在展开辣度的那一条被删了，收起展开态
    const patch = { items: items, totalCount: this.countOf(items) }
    if (this.data.spiceOpenKey === key) patch.spiceOpenKey = ''
    this.setData(patch)
  },

  // 辣度：平时只显示选定的那一档，点一下才就地展开四档重选
  onOpenSpice(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ spiceOpenKey: key })
  },

  // 列表里直接改辣度：选中即收起，回到「只显示选定的辣度」
  onTapSpice(e) {
    const key = e.currentTarget.dataset.key
    const spice = e.currentTarget.dataset.spice
    const r = applyRowChange(this.data.items, key, { spice: spice })
    if (!r.found) return
    this.setData({ items: r.items, totalCount: this.countOf(r.items), spiceOpenKey: '' })
    // 合并到别条时，面板要跟着换到活下来那条
    if (this.data.editorOpen && this.data.editorKey === key) {
      this.setData({ editorKey: r.key })
    }
  },

  // 单道菜的备注：点备注行直接写，不必打开面板（与确认订单页同一套交互）
  // 用弹窗输入而非行内 input —— 本页改动都会重设 items，行内受控 input 会把光标顶到末尾
  onTapNote(e) {
    const key = e.currentTarget.dataset.key
    const row = this.data.items.find(function (it) {
      return it.key === key
    })
    if (!row) return
    const self = this
    wx.showModal({
      title: '「' + row.name + '」单独说一句',
      editable: true,
      placeholderText: '比如：不放葱（最多 ' + DISH_NOTE_MAX + ' 字）',
      content: row.note || '',
      confirmText: '写好了',
      cancelText: '不改了',
      success: function (res) {
        if (!res.confirm) return
        const note = String(res.content || '')
          .trim()
          .slice(0, DISH_NOTE_MAX)
        const r = applyRowChange(self.data.items, key, { note: note })
        if (!r.found) return
        self.setData({ items: r.items, totalCount: self.countOf(r.items) })
        // 面板正开着这一行时，把面板里的草稿一起刷新，避免两边不一致
        if (self.data.editorOpen && self.data.editorKey === key) {
          const cur = r.items.find(function (it) {
            return it.key === r.key
          })
          self.setData({
            editorKey: r.key,
            editorItem: cur
              ? { name: cur.name, emoji: cur.emoji, spice: cur.spice, note: cur.note }
              : null,
          })
        }
        ui.toast(note ? '记下来了 📝' : '已清空')
      },
    })
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
    const info = spiceInfo(spice)
    const row = {
      dishId: dish._id || dish.id,
      name: dish.name,
      emoji: dish.emoji || '🍴',
      spice: spice,
      spiceIdx: info.level,
      spiceLabel: info.label,
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
    // 终态兜底：已上菜的订单即使绕过入口进到本页，也不允许保存
    if (this.data.finalized) {
      ui.toast('这一单已上菜，不能再改了')
      return
    }
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
