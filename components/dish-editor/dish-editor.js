// 「改这道菜」面板（确认订单页 / 编辑订单页共用）
//
// 一道菜选好之后常见的三种修改都收在这里：
//   1. 改辣度（四档）
//   2. 写 / 改这一道菜的备注（带快捷短语）
//   3. 换一道菜（直接从菜单里重选）
//
// 职责边界：组件只管「草稿 + 交互」，真正写入交给页面 ——
// 每次改动都 triggerEvent('change', { spice | note | dish })，
// 页面把它落到购物车或订单条目上。这样页面永远持有最新数据，即使面板被直接关掉也不会丢改动。
//
// 备注的提交时机：输入过程中只更新本地草稿（受控 value 每敲一个字就回写会让光标跳到末尾），
// 失焦 / 点快捷短语 / 清空 / 点「好了」时才提交一次。
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const { CATEGORIES, SPICE_LEVELS, DISH_NOTE_MAX, DISH_NOTE_TAGS } = require('../../utils/constants')

const ALL = { key: '全部', emoji: '📜' }

Component({
  properties: {
    // 正在编辑的条目 { name, emoji, spice, note }：只用来做初值
    item: { type: Object, value: null },
  },

  data: {
    spiceLevels: SPICE_LEVELS,
    noteTags: DISH_NOTE_TAGS,
    noteMax: DISH_NOTE_MAX,
    // 草稿
    spice: '不辣',
    note: '',
    // 换菜（菜单选择）
    pickerOpen: false,
    pickerLoading: false,
    categories: [ALL].concat(CATEGORIES),
    activeCategory: '全部',
    allDishes: [],
    pickerDishes: [],
  },

  lifetimes: {
    attached() {
      const it = this.properties.item || {}
      this._lastNote = it.note || ''
      this.setData({
        spice: it.spice || '不辣',
        note: it.note || '',
      })
    },
  },

  methods: {
    emitChange(detail) {
      this.triggerEvent('change', detail || {})
    },

    // ---------- 辣度 ----------

    onTapSpice(e) {
      const spice = e.currentTarget.dataset.spice
      if (!spice || spice === this.data.spice) return
      this.setData({ spice: spice })
      this.emitChange({ spice: spice })
    },

    // ---------- 备注 ----------

    onNoteInput(e) {
      this.setData({ note: e.detail.value })
    },

    onNoteBlur() {
      this.commitNote()
    },

    // 点快捷短语：已写过的就不重复叠加，避免「少放盐、少放盐」
    onTapNoteTag(e) {
      const tag = e.currentTarget.dataset.tag
      if (!tag) return
      const note = this.data.note || ''
      if (note.indexOf(tag) >= 0) {
        ui.toast('已经写上啦')
        return
      }
      const next = (note ? note + '、' + tag : tag).slice(0, this.data.noteMax)
      this.setData({ note: next })
      this.commitNote()
    },

    onClearNote() {
      this.setData({ note: '' })
      this.commitNote()
    },

    // 只在内容真的变了的时候提交
    commitNote() {
      const note = String(this.data.note || '').trim()
      if (note === this._lastNote) return
      this._lastNote = note
      this.emitChange({ note: note })
    },

    // ---------- 换一道菜 ----------

    openPicker() {
      this.setData({ pickerOpen: true })
      if (this.data.allDishes.length) {
        this.applyPickerFilter()
        return
      }
      const self = this
      this.setData({ pickerLoading: true })
      api
        .call('listDishes')
        .then(function (res) {
          self.setData({ allDishes: res.dishes || [], pickerLoading: false })
          self.applyPickerFilter()
        })
        .catch(function (err) {
          console.error('[dish-editor] 菜单加载失败', err)
          self.setData({ pickerLoading: false })
          ui.toast('菜单没加载出来，稍后再试')
        })
    },

    closePicker() {
      this.setData({ pickerOpen: false })
    },

    onTapCategory(e) {
      this.setData({ activeCategory: e.currentTarget.dataset.cat })
      this.applyPickerFilter()
    },

    applyPickerFilter() {
      const { allDishes, activeCategory } = this.data
      this.setData({
        pickerDishes:
          activeCategory === '全部'
            ? allDishes
            : allDishes.filter(function (d) {
                return d.category === activeCategory
              }),
      })
    },

    onPickDish(e) {
      const dish = this.data.pickerDishes[e.currentTarget.dataset.idx]
      if (!dish) return
      // 换成新菜后辣度跟着新菜的推荐值走，避免「清蒸鱼·特辣」这种意外
      const spice = dish.spice || '不辣'
      this.setData({ spice: spice, pickerOpen: false })
      this.emitChange({
        dish: {
          dishId: dish._id || dish.id,
          name: dish.name,
          emoji: dish.emoji || '🍴',
          spice: spice,
        },
      })
      ui.toast('换成「' + dish.name + '」了')
    },

    // ---------- 关闭 ----------

    // 键盘还开着就直接点关闭时，blur 不一定触发，这里兜一次
    onClose() {
      this.commitNote()
      this.triggerEvent('close')
    },

    // 弹层内容区不穿透关闭
    noop() {},
  },
})
