// 订单详情页：同一个页面，多种形态
//
//   干饭人（下单的人）→ 编辑态：改菜、改辣度 / 备注、换菜、改用餐时间、改署名，
//                        被驳回时看到理由，改完点「改好重新提交」。
//                        **没有状态开关** —— 状态是掌勺人的事。
//                        待开做 / 已驳回才能改；开做中、已上菜对 TA 也是只读。
//   掌勺人            → 只读态：菜品 / 备注 / 用餐时间都只看不改，
//                        底部只有「开始做 / 做好了」和「驳回（要写理由）」。
//
// 为什么用同一个页面而不是两个：读的部分完全一样，只有底部那排按钮不同；
// 拆两个页面会让「已上菜只读」这套逻辑要维护两遍（另见 pages/orders 的入口分工）。
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const dine = require('../../utils/dine')
const store = require('../../utils/store')
const rejectLib = require('../../utils/reject')
const live = require('../../utils/live')
const { ORDER_STATUS, SPICE_LEVELS, spiceInfo, DISH_NOTE_MAX, AVOID_MAX, AVOID_TEXT_MAX } = require('../../utils/constants')

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
    // 状态只做展示（干饭人看），推不推进由掌勺人在订单页 / 待做页做
    statusEmoji: ORDER_STATUS.pending.emoji,
    statusText: ORDER_STATUS.pending.text,
    spiceLevels: SPICE_LEVELS,
    // 辣度平时只显示「当前选的那一档」；这一条是正在展开重选的那道菜
    spiceOpenKey: '',
    // 加菜弹层：取菜单 / 分类 / 搜索三件事都在 components/dish-picker 里，
    // 本页只留一个开关（原先这里还存着 allDishes / pickerDishes / categories，
    // 与改菜面板各存一份，改一处不连带改另一处）
    pickerOpen: false,
    totalCount: 0,
    loading: true,
    // 加载失败：不再把用户直接踢回上一页，改为页内错误态 + 重试
    loadError: false,
    saving: false,
    // 身份与视图形态
    isCook: false,
    // 只读：掌勺人（不是他点的单）、已上菜的终态
    readonly: false,
    // 已上菜 = 终态（对干饭人也是）：本页退化成只读展示
    finalized: false,
    // 掌勺人才能推进状态 / 驳回（已上菜之后就没了）
    showStatusActions: false,
    canReject: false,
    // 被驳回：掌勺人写了理由，干饭人改完可以重新提交
    rejected: false,
    rejectReason: '',
    // 只读态顶部那张说明卡
    readonlyEmoji: '',
    readonlyTitle: '',
    readonlySub: '',
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
    // 忌口清单：掌勺人看订单里的快照，干饭人看自己当前的清单（保存时一并更新）
    avoids: [],
    avoidMax: AVOID_MAX,
    avoidTextMax: AVOID_TEXT_MAX,
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
    // 身份：本页两个身份都能进 —— 干饭人改内容、掌勺人只读推进状态，
    // 所以这里不做「没选身份就弹回去」的门槛判断（与 checkout 一致）。
    // 真没选过身份时按干饭人渲染；实际上从订单页进来时身份一定已经有了。
    const isCook = store.getRole() === 'cook'
    this.setData({ id: id, isCook: isCook })
    wx.setNavigationBarTitle({ title: isCook ? '这一单' : '改改这一单' })
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
      const items = this.decorate(order.items)
      const now = new Date()
      const dates = dine.buildDateOptions(now)
      // 老订单没存过用餐时间 → 默认今天 + 当前时段；
      // 存过但已超出可选范围（比如过期日期）→ 也回落到默认
      const savedDate = order.dine_date || ''
      const dateValid = dates.some(function (d) {
        return d.value === savedDate && !d.disabled
      })
      const date = dateValid ? savedDate : dine.defaultDate(now)
      const slots = dine.buildSlotOptions(now, date)
      const savedSlot = order.dine_slot || ''
      const slotHit = slots.find(function (s) {
        return s.key === savedSlot
      })
      const slot = slotHit && !slotHit.disabled ? savedSlot : dine.defaultSlot(now, date)
      const status = order.status || 'pending'
      const done = status === 'done'
      const cooking = status === 'cooking'
      const rejected = status === 'rejected'
      const isCook = this.data.isCook
      // 只读的几种情况不一样，文案也就不一样（同一个页面多种身份 + 终态 + 开做中）
      const badge = this.readonlyBadge(isCook, done, rejected, cooking)
      const info = ORDER_STATUS[status] || ORDER_STATUS.pending
      this.setData({
        items: items,
        remark: order.remark || '',
        orderBy: order.order_by || '',
        status: status,
        statusEmoji: info.emoji,
        statusText: info.text,
        isCook: isCook,
        // 只读：掌勺人（不是他点的单）、已上菜的终态、开做中（掌勺人已经开火）
        readonly: isCook || done || cooking,
        finalized: done,
        showStatusActions: isCook && !done,
        canReject: isCook && !done && rejectLib.canReject(status),
        rejected: rejected,
        rejectReason: order.reject_reason || '',
        readonlyEmoji: badge.emoji,
        readonlyTitle: badge.title,
        readonlySub: badge.sub,
        totalCount: this.countOf(items),
        // 「周三 10/1 · 午餐」；老订单没填 → 「尽快」
        dineText: dine.formatDine(order.dine_date, order.dine_slot),
        dineDates: dates,
        dineDate: date,
        dineSlots: slots,
        dineSlot: slot,
        // 忌口：掌勺人看的是**订单里冻结的快照** —— 他本地压根没有对方的清单，
        // 能看到忌口全靠它跟着订单上了云；而干饭人看的是自己**当前**的清单，
        // 保存时会一并更新上去（所以两边读的不是同一个来源，别合并成一处）。
        avoids: isCook ? order.avoids || [] : store.getAvoids(),
        loading: false,
      })
    } catch (err) {
      console.error('[order-edit] 加载订单失败', err)
      // 失败不再 toast 完就把人踢回上一页（那样用户只能自己再点一次进来，
      // 没有重试入口）；改为页内错误态，由用户决定重试还是返回。
      this.setData({ loading: false, loadError: true })
    }
  },

  onRetry() {
    if (!this.data.id) return
    this.loadOrder(this.data.id)
  },

  /**
   * 只读态顶部那句说明：掌勺人（不是他点的单）/ 已上菜（终态）/
   * 开做中（对干饭人 —— 掌勺人已经开火了）。
   * 抽出来是为了「同一个页面多种形态」的文案不会写歪在模板里。
   */
  readonlyBadge(isCook, done, rejected, cooking) {
    if (done) {
      return {
        emoji: '🎉',
        title: '这一单已经上菜啦',
        sub: isCook ? '完成后的订单不再支持修改' : '完成后的订单不再支持修改，只能删掉',
      }
    }
    if (rejected) {
      return {
        emoji: '🙅',
        title: '这一单你已经驳回了',
        sub: '等 TA 改好重新提交，或者把驳回收回来',
      }
    }
    // 开做中：只有干饭人（掌勺人此时走上面的默认文案，他的按钮在下面）
    if (cooking && !isCook) {
      return {
        emoji: '🍳',
        title: '掌勺人正在做这一单',
        sub: '开做之后就改不了单啦，有想说的直接和 TA 讲',
      }
    }
    return {
      emoji: '🧑‍🍳',
      title: '这一单是 TA 点的',
      sub: '你只能更新状态或驳回，菜品内容不能改',
    }
  },

  // ---------- 同步编辑 ----------

  onNickInput(e) {
    this.setData({ orderBy: e.detail.value })
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  // 改单时临时补一条忌口（完整维护在「我的」页）。
  // 和结算页一样走弹窗输入：本页任何改动都要 setData 重画列表，
  // 行内受控 input 回写 value 会把光标顶到末尾。
  onAddAvoid() {
    if (this.data.readonly) return
    if (this.data.avoids.length >= AVOID_MAX) {
      ui.toast('忌口最多 ' + AVOID_MAX + ' 条')
      return
    }
    const self = this
    wx.showModal({
      title: '不吃什么？',
      editable: true,
      placeholderText: '比如：芥末（最多 ' + AVOID_TEXT_MAX + ' 字）',
      confirmText: '记下',
      cancelText: '算了',
      success: function (res) {
        if (!res.confirm) return
        const text = String(res.content || '').trim()
        if (!text) return
        if (!store.addAvoid(text)) {
          ui.toast('已经在清单里啦')
          return
        }
        self.setData({ avoids: store.getAvoids() })
        ui.toast('记下了，保存时会一起告诉 TA 🙅', 'success')
      },
    })
  },

  // 注意：本页**没有**改状态的入口。状态由掌勺人在订单页 / 待做页推进，
  // 干饭人这边连控件都不给（原来那排可选状态的小胶囊已随之删掉）。

  // ---------- 用餐时间 ----------

  onPickDineDate(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.dineDate) return
    const hit = this.data.dineDates.find(function (d) {
      return d.value === value
    })
    if (!hit || hit.disabled) return
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
  //
  // cart-list 组件把点击翻成一个通用 act 事件，这里统一分发。
  // 「按 key 定位」这件事只在这一层做一次，下面每个 handler 都直接收 key 参数 ——
  // 免得每个 handler 都要自己去 e.currentTarget.dataset 里掏。
  onCartAct(e) {
    const d = e.detail || {}
    const key = d.key
    if (!key) return
    if (d.act === 'edit') return this.openEditor(key)
    if (d.act === 'open-spice') return this.onOpenSpice(key)
    if (d.act === 'spice') return this.onTapSpice(key, d.spice)
    if (d.act === 'note') return this.onTapNote(key)
    if (d.act === 'qty') return this.onQtyChange(key, d.delta)
    if (d.act === 'remove') return this.onRemoveItem(key)
  },

  onQtyChange(key, delta) {
    delta = Number(delta)
    if (!delta) return
    const items = this.data.items
      .map(function (it) {
        return it.key === key ? Object.assign({}, it, { qty: it.qty + delta }) : it
      })
      .filter(function (it) {
        return it.qty > 0
      })
    this.setData({ items: items, totalCount: this.countOf(items) })
  },

  onRemoveItem(key) {
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
  onOpenSpice(key) {
    if (!key) return
    this.setData({ spiceOpenKey: key })
  },

  // 列表里直接改辣度：选中即收起，回到「只显示选定的辣度」
  onTapSpice(key, spice) {
    if (!spice) return
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
  onTapNote(key) {
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

  openEditor(key) {
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
  //
  // 弹层的取菜单 / 分类 / 搜索都在 components/dish-picker 里
  // （与改菜面板的「换一道菜」共用同一份，别在这里再写一遍）。
  // 这一层只管三件事：开、关、把选中的那一道并进 items。

  openPicker() {
    this.setData({ pickerOpen: true })
  },

  closePicker() {
    this.setData({ pickerOpen: false })
  },

  // 组件抛回来的选中项。刻意**不关闭弹层** —— 一单常常要连加好几道，
  // 关不关由用户点 ✕ 决定（组件不知道这个业务判断，所以它也不自己关）。
  onPickerPick(e) {
    const dish = (e.detail || {}).dish
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

  // ---------- 保存 / 删除 / 掌勺人的状态动作 ----------

  async onSave() {
    if (this.data.saving) return
    // 只读兜底：掌勺人绕过入口进到本页也不允许保存（他只推进状态 / 驳回），
    // 已上菜的终态、开做中的单同理 —— 与服务端的拦截一一对应
    if (this.data.isCook) {
      ui.toast('这一单是 TA 点的，你只能更新状态或驳回')
      return
    }
    if (this.data.finalized) {
      ui.toast('这一单已上菜，不能再改了')
      return
    }
    if (this.data.status === 'cooking') {
      ui.toast('这一单正在做，等做完这顿再说吧')
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
          // 刻意不传 status：状态是掌勺人的事。被驳回的单改完后，
          // 服务端会把它自动退回「待开做」—— 这一次保存就等于「重新提交」。
          dine_date: this.data.dineDate,
          dine_slot: this.data.dineSlot,
          // 忌口：改完菜顺手把最新清单也同步上去 ——
          // 别让掌勺人照着改单前的旧忌口做菜
          avoids: store.getAvoids(),
        },
      })
      ui.hideLoading()
      if (!res.updated) {
        ui.toast('没保存成功，再试一次')
        this.setData({ saving: false })
        return
      }
      ui.toast(this.data.rejected ? '改好重新提交啦 ✓' : '改好了 ✓')
      setTimeout(function () {
        wx.navigateBack()
      }, ui.TOAST_DURATION)
    } catch (err) {
      ui.hideLoading()
      console.error('[order-edit] 保存订单失败', err)
      ui.toast((err && err.message) || '没保存成功，再试一次')
      this.setData({ saving: false })
    }
  },

  // ---------- 掌勺人的三个动作（只读态底部那排按钮） ----------

  // 状态推进与订单页共用同一个 action，两处手感保持一致
  async setStatus(nextStatus) {
    ui.showLoading('处理中…')
    try {
      const res = await api.call('updateOrderStatus', { id: this.data.id, status: nextStatus })
      ui.hideLoading()
      if (!res || !res.updated) {
        ui.toast('没更新成功，再试一次')
        return
      }
      ui.toast(nextStatus === 'cooking' ? '开做啦，加油 💪' : '上菜咯，开饭 🎉')
      setTimeout(function () {
        wx.navigateBack()
      }, ui.TOAST_DURATION)
    } catch (err) {
      ui.hideLoading()
      console.error('[order-edit] 状态更新失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  onStartCooking() {
    this.setStatus('cooking')
  },

  // 「已上菜」是终态（之后只能删单）→ 二次确认防误点
  onFinishCooking() {
    const self = this
    wx.showModal({
      title: '这一单都上菜啦？',
      content: '标记「已上菜」后就不能再改了哦',
      confirmText: '上菜咯',
      confirmColor: '#FF7A9E',
      cancelText: '再做会儿',
      success: function (res) {
        if (res.confirm) self.setStatus('done')
      },
    })
  },

  // 驳回：做不了就直说，理由必填（快捷说法一键选）
  async onReject() {
    if (!this.data.canReject) {
      ui.toast('这一单现在没法驳回')
      return
    }
    const input = await ui.askReason(rejectLib.QUICK_REASONS, {
      title: '为什么先不做这一单？',
      placeholder: '比如：今天没买到排骨',
      confirmText: '就这么说',
    })
    if (input === null) return

    const reason = rejectLib.normalizeReason(input)
    if (!reason) {
      ui.toast('还是说一句理由吧')
      return
    }
    ui.showLoading('正在驳回…')
    try {
      const res = await api.call('rejectOrder', { id: this.data.id, reason: reason })
      ui.hideLoading()
      if (!res || !res.updated) {
        ui.toast('没驳回成功，再试一次')
        return
      }
      ui.toast('已经告诉 TA 了 🙅')
      setTimeout(function () {
        wx.navigateBack()
      }, ui.TOAST_DURATION)
    } catch (err) {
      ui.hideLoading()
      console.error('[order-edit] 驳回失败', err)
      ui.toast('网络开小差了，稍后再试')
    }
  },

  // 手滑驳错了 → 收回来（状态退回待开做）
  onWithdrawReject() {
    const self = this
    wx.showModal({
      title: '收回这次驳回？',
      content: '这一单会回到「待开做」，TA 那边也会看到',
      confirmText: '收回来',
      confirmColor: '#FF7A9E',
      cancelText: '算了',
      success: function (res) {
        if (res.confirm) self.setStatus('pending')
      },
    })
  },

  // 删除整单：只有干饭人能删自己点的单（掌勺人只能驳回）。
  // 开做中的单删不得（掌勺人正在做这顿饭），与服务端拦截一致。
  onDelete() {
    const id = this.data.id
    if (!id) return
    if (this.data.isCook) {
      ui.toast('这一单是 TA 点的，你只能驳回哦')
      return
    }
    if (this.data.status === 'cooking') {
      ui.toast('这一单正在做，等做完再删吧')
      return
    }
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
          }, ui.TOAST_DURATION)
        } catch (err) {
          ui.hideLoading()
          console.error('[order-edit] 删除订单失败', err)
          ui.toast('网络开小差了，稍后再试')
        }
      },
    })
  },

  // 本页不轮询订单（要点进来才能改，改动自己走保存按钮）。
  // onUnload 里恢复 App 级轮询：弹窗期间可能暂停过它。
  onUnload() {
    live.resume()
  },
})
