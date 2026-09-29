// 「我的」页：两种身份共用的基本资料
// 内容：头像（微信选头像，saveFile 持久化）、称呼、个人介绍、当前状态、
//       忌口清单（只有点餐人需要：谁吃饭谁提要求）、当前身份
// 都存本地 —— 双人小应用，不需要账号体系
const store = require('../../utils/store')
const { roleInfo, moodInfo, MOODS, AVOID_COMMON, AVOID_MAX, AVOID_TEXT_MAX, INTRO_MAX } = require('../../utils/constants')
const ui = require('../../utils/ui')

// 昵称字数上限：显示在订单「来自 xx」里，短一点好看
const NICK_MAX = 12

// 快捷标签带选中态：已在清单里的显示 ✓（点一下移除），没加的显示 ＋（点一下加入）
// 这样一眼能看出「我选了什么」，不用在标签区和清单区之间来回对照
function tagState(avoids) {
  const on = {}
  ;(avoids || []).forEach(function (t) {
    on[t] = true
  })
  return AVOID_COMMON.map(function (t) {
    return { text: t, on: !!on[t] }
  })
}

Page({
  data: {
    role: '',
    roleInfo: null,
    // 做饭人：谁吃饭谁提要求，做饭人自己的资料页不要忌口清单
    isCook: false,
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
    // 忌口清单（只有点餐人用）
    avoids: [],
    avoidMax: AVOID_MAX,
    avoidTextMax: AVOID_TEXT_MAX,
    commonTags: tagState([]),
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
    const avoids = store.getAvoids()
    this.setData({
      role: role,
      roleInfo: roleInfo(role),
      isCook: role === 'cook',
      avatar: store.getAvatar(),
      nickname: store.getNickname(),
      dirty: false,
      intro: store.getIntro(),
      introDirty: false,
      moodKey: moodKey,
      moodInfo: moodInfo(moodKey),
      avoids: avoids,
      commonTags: tagState(avoids),
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

  // ---------- 忌口清单（只给点餐人） ----------
  // 写操作统一从 store 重新取一遍，保证清单与标签选中态永远一致
  syncAvoids() {
    const avoids = store.getAvoids()
    this.setData({ avoids: avoids, commonTags: tagState(avoids) })
  },

  // 快捷标签是个开关：没加过 → 加上；已经在清单里 → 去掉
  onCommonTagTap(e) {
    if (this.data.isCook) return
    const tag = e.currentTarget.dataset.tag
    if (store.getAvoids().indexOf(tag) >= 0) {
      store.removeAvoid(tag)
      this.syncAvoids()
      ui.toast('已去掉「' + tag + '」')
      return
    }
    if (!store.addAvoid(tag)) {
      ui.toast(store.getAvoids().length >= AVOID_MAX ? '忌口最多 ' + AVOID_MAX + ' 条' : '已经在清单里啦')
      return
    }
    this.syncAvoids()
    ui.toast('已加上「' + tag + '」', 'success')
  },

  onRemoveAvoid(e) {
    if (this.data.isCook) return
    store.removeAvoid(e.currentTarget.dataset.tag)
    this.syncAvoids()
  },

  // 清空整份清单（二次确认，别手滑）
  onClearAvoids() {
    if (this.data.isCook || this.data.avoids.length === 0) return
    const self = this
    wx.showModal({
      title: '清空忌口清单？',
      content: '这 ' + this.data.avoids.length + ' 条会一起删掉',
      confirmText: '清空',
      cancelText: '留着',
      success: function (res) {
        if (!res.confirm) return
        store.setAvoids([])
        self.syncAvoids()
        ui.toast('清单已清空')
      },
    })
  },

  // 手动输入一条忌口（快捷标签没有的）
  onAddAvoid() {
    if (this.data.isCook) return
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
        self.syncAvoids()
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
