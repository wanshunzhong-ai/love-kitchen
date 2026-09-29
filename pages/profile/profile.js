// 基本资料页：两种身份共用的「我的」页
// 内容：昵称（下单署名）、当前身份（可切换）
// 都存本地 —— 双人小应用，不需要账号体系
const store = require('../../utils/store')
const { roleInfo } = require('../../utils/constants')
const ui = require('../../utils/ui')

// 昵称字数上限：显示在订单「来自 xx」里，短一点好看
const NICK_MAX = 12

Page({
  data: {
    role: '',
    roleInfo: null,
    nickname: '',
    nickMax: NICK_MAX,
    // 改过还没保存：显示「保存」按钮提醒
    dirty: false,
  },

  onShow() {
    // 身份守卫：没选过身份 → 送去选择页
    const role = store.ensureRole()
    if (!role) return
    this.setData({
      role: role,
      roleInfo: roleInfo(role),
      nickname: store.getNickname(),
      dirty: false,
    })
  },

  onNickInput(e) {
    this.setData({ nickname: e.detail.value, dirty: true })
  },

  saveNickname() {
    const nick = String(this.data.nickname || '').trim().slice(0, NICK_MAX)
    store.setNickname(nick)
    this.setData({ nickname: nick, dirty: false })
    ui.toast('已保存', 'success')
  },

  // 去身份选择页换身份；先保存昵称，别让用户白写
  goRoleSelect() {
    if (this.data.dirty) this.saveNickname()
    wx.reLaunch({ url: '/pages/role-select/role-select' })
  },
})
