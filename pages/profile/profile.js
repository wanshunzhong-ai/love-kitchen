// 「我的」页：两种身份共用的基本资料
// 内容：头像（微信选头像，saveFile 持久化）、称呼、当前状态、忌口清单、当前身份
// 都存本地 —— 双人小应用，不需要账号体系
const store = require('../../utils/store')
const { roleInfo, moodInfo, MOODS, AVOID_COMMON, AVOID_MAX, AVOID_TEXT_MAX, INTRO_MAX } = require('../../utils/constants')
const ui = require('../../utils/ui')

// 昵称字数上限：显示在订单「来自 xx」里，短一点好看
const NICK_MAX = 12

Page({
  data: {
    role: '',
    roleInfo: null,
    // 头像
    avatar: '',
    // 称呼
    nickname: '',
    nickMax: NICK_MAX,
    // 改过还没保存：显示「保存」按钮提醒
    dirty: false,
    // 个人介绍
    intro: '',
    introMax: INTRO_MAX,
    introDirty: false,
    // 当前状态
    moods: Object.keys(MOODS).map(function (k) {
      return MOODS[k]
    }),
    moodKey: '',
    moodInfo: null,
    // 忌口清单
    avoids: [],
    avoidMax: AVOID_MAX,
    avoidTextMax: AVOID_TEXT_MAX,
    commonTags: AVOID_COMMON,
  },

  onShow() {
    // 自定义 tabBar：同步选中态 + 按身份重算 tab 列表
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 'profile' })
      this.getTabBar().refresh()
    }
    // 身份守卫：没选过身份 → 送去选择页
    const role = store.ensureRole()
    if (!role) return
    const moodKey = store.getMood()
    this.setData({
      role: role,
      roleInfo: roleInfo(role),
      avatar: store.getAvatar(),
      nickname: store.getNickname(),
      dirty: false,
      intro: store.getIntro(),
      introDirty: false,
      moodKey: moodKey,
      moodInfo: moodInfo(moodKey),
      avoids: store.getAvoids(),
    })
  },

  // ---------- 头像 ----------
  // 微信选头像（open-type=chooseAvatar），拿到临时路径后 saveFile 持久化
  onChooseAvatar(e) {
    const tmp = e.detail.avatarUrl
    if (!tmp) return
    const self = this
    wx.getFileSystemManager().saveFile({
      tempFilePath: tmp,
      success(res) {
        store.setAvatar(res.savedFilePath)
        self.setData({ avatar: res.savedFilePath })
        ui.toast('头像已更新', 'success')
      },
      fail() {
        // 持久化失败就用临时路径顶着，下次再选
        store.setAvatar(tmp)
        self.setData({ avatar: tmp })
      },
    })
  },

  // ---------- 称呼 ----------
  onNickInput(e) {
    this.setData({ nickname: e.detail.value, dirty: true })
  },

  saveNickname() {
    const nick = String(this.data.nickname || '').trim().slice(0, NICK_MAX)
    store.setNickname(nick)
    this.setData({ nickname: nick, dirty: false })
    ui.toast('已保存', 'success')
  },

  // ---------- 个人介绍 ----------
  onIntroInput(e) {
    this.setData({ intro: e.detail.value, introDirty: true })
  },

  saveIntro() {
    const intro = store.setIntro(this.data.intro)
    this.setData({ intro: intro, introDirty: false })
    ui.toast('介绍已保存', 'success')
  },

  // ---------- 当前状态 ----------
  onMoodTap(e) {
    const key = e.currentTarget.dataset.key
    if (!moodInfo(key)) return
    store.setMood(key)
    this.setData({ moodKey: key, moodInfo: moodInfo(key) })
    ui.toast('现在' + MOODS[key].text, 'success')
  },

  // ---------- 忌口清单 ----------
  onCommonTagTap(e) {
    const tag = e.currentTarget.dataset.tag
    if (!store.addAvoid(tag)) {
      ui.toast(store.getAvoids().length >= AVOID_MAX ? '忌口最多 ' + AVOID_MAX + ' 条' : '已经在清单里啦')
      return
    }
    this.setData({ avoids: store.getAvoids() })
    ui.toast('已加上「' + tag + '」', 'success')
  },

  onRemoveAvoid(e) {
    store.removeAvoid(e.currentTarget.dataset.tag)
    this.setData({ avoids: store.getAvoids() })
  },

  // 手动输入一条忌口（快捷标签没有的）
  onAddAvoid() {
    if (this.data.avoids.length >= AVOID_MAX) {
      ui.toast('忌口最多 ' + AVOID_MAX + ' 条')
      return
    }
    const self = this
    wx.showModal({
      title: '不吃什么？',
      editable: true,
      placeholderText: '比如：芥末（最多 ' + AVOID_TEXT_MAX + ' 字）',
      confirmText: '加上',
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
        ui.toast('已加上「' + text.slice(0, AVOID_TEXT_MAX) + '」', 'success')
      },
    })
  },

  // ---------- 身份 ----------
  // 去身份选择页换身份；先保存没落的称呼和介绍，别让用户白写
  goRoleSelect() {
    if (this.data.dirty) this.saveNickname()
    if (this.data.introDirty) this.saveIntro()
    wx.reLaunch({ url: '/pages/role-select/role-select' })
  },
})
