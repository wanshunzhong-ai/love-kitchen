// 身份选择页：首次进入（或主动切换）时二选一
// 选完落本地存储，然后直接跳到该身份的默认首页（干饭人→点单，掌勺人→待做）
const store = require('../../utils/store')
const { ROLES, roleInfo } = require('../../utils/constants')
const ui = require('../../utils/ui')

Page({
  data: {
    // 两种身份都传给模板渲染卡片；ROLES 是对象，转成数组好遍历
    roles: [ROLES.orderer, ROLES.cook],
    // 已选过的身份（可能为空）——用来标「当前身份」
    role: '',
    roleText: '',
  },

  onShow() {
    const role = store.getRole()
    const info = roleInfo(role)
    this.setData({
      role: role,
      roleText: info ? info.text : '',
    })
  },

  // 已选过身份的老用户：一键继续，别再让人手点卡片（每冷启动省一次点击）。
  // 点下面的卡片仍然可以换身份，这条路不受影响。
  onContinue() {
    const info = roleInfo(this.data.role)
    if (!info) return
    wx.reLaunch({ url: info.home })
  },

  onPick(e) {
    const key = e.currentTarget.dataset.role
    const info = roleInfo(key)
    if (!info) return

    const isSwitch = !!this.data.role && this.data.role !== key
    store.setRole(key)

    if (isSwitch) {
      ui.toast('已切换为' + info.text, 'success')
    }
    // 落库后进该身份的默认首页；reLaunch 清掉页面栈，守卫逻辑不会残留
    wx.reLaunch({ url: info.home })
  },
})
