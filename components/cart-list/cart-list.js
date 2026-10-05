/**
 * 购物车 / 订单条目列表
 *
 * 抽出来的原因：pages/checkout 与 pages/order-edit 在渲染**逐字相同**的一套
 * 「菜品行」，26 个同名类（.cart-item / .ci-* / .step*）各写一遍。唯一差别只是
 * 数据里拿哪一列当行身份（结算页是购物车的 uid，编辑订单页是 dishId|辣度 的 key）
 * 和「再加几个菜」那句话点什么。
 *
 * 职责边界：组件只渲染 + 把点击翻译成一个通用 `act` 事件，
 * 不认识业务（不知道什么是购物车、什么是订单）：
 *   act = 'edit'        点了 ✏️（打开逐道菜面板）
 *   act = 'open-spice'  点了辣度胶囊（就地展开四档）
 *   act = 'spice'       选了某一档（detail.spice）
 *   act = 'note'        点了备注行（写这一道菜的备注）
 *   act = 'qty'         加减数量（detail.delta = ±1）
 *   act = 'remove'      点了 ✕
 * 页面收到后自己决定怎么落库 —— 两条路径的落库方式完全不同
 * （一个写本地 storage，一个改内存 items 后保存）。
 *
 * 行身份统一走 items[i].key：两个页面在传进来之前都先把 key 补齐。
 * openKey 是「哪一行正在展开辣度」，与 item.key 比对。
 */
Component({
  properties: {
    /** 条目数组：[{ key, emoji, name, spice, spiceIdx, spiceLabel, note, qty }] */
    items: { type: Array, value: [] },
    /** 辣度档位常量（四档），由页面从 utils/constants 传入 */
    spiceLevels: { type: Array, value: [] },
    /** 正在展开辣度的那一行的 key；空串 = 全都收起 */
    openKey: { type: String, value: '' },
    /** 列表下方的「再加几个菜」文案；留空则不出这一行 */
    addText: { type: String, value: '' },
    /** 列表为空时的提示文案；留空则不出 */
    hint: { type: String, value: '' },
  },

  methods: {
    /** 统一出口：把 dataset 里的信息翻成 act 事件 */
    emit(act, e, extra) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent(
        'act',
        Object.assign({ act: act, key: ds.key }, extra || {}),
      )
    },

    onEdit(e) {
      this.emit('edit', e)
    },

    onOpenSpice(e) {
      this.emit('open-spice', e)
    },

    onTapSpice(e) {
      const spice = e.currentTarget.dataset.spice
      if (!spice) return
      this.emit('spice', e, { spice: spice })
    },

    onTapNote(e) {
      this.emit('note', e)
    },

    onQty(e) {
      const delta = Number(e.currentTarget.dataset.delta)
      if (!delta) return
      this.emit('qty', e, { delta: delta })
    },

    onRemove(e) {
      this.emit('remove', e)
    },

    onAdd() {
      this.triggerEvent('add')
    },

    // 弹层 / 蒙层场景下不穿透；这里只防列表行内部误触
    noop() {},
  },
})
