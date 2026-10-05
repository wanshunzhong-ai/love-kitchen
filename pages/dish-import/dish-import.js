// 批量加菜页：CSV / TSV 文本 → 一次导入多道菜
//
// 三种拿到文本的方式（都有人用，所以都给）：
//   1) 从微信聊天选 .csv 文件 —— 官方唯一能读任意文件的口子
//   2) 读剪贴板 —— 在电脑上从 Excel 复制，手机上直接粘
//   3) 手动粘贴到文本框 —— 兜底，也方便临时改几行
//
// 交互上刻意分两步：先「解析预览」再「确认导入」。
// 因为批量导入是难以逐个撤销的操作，写进去之前必须让人看清
// 「哪些是新增、哪些会覆盖、哪些被跳过、哪些行有问题」。
const api = require('../../utils/api')
const ui = require('../../utils/ui')
const csv = require('../../utils/csv')
const { CATEGORIES, SPICE_LEVELS } = require('../../utils/constants')

// 预览区一次列多少行（多了折叠，不然一次 setData 几百条会卡）
const PREVIEW_PAGE = 30

Page({
  data: {
    // input = 还在选/粘内容；preview = 解析完了等确认；result = 导完了
    stage: 'input',
    pasteText: '',
    // 选了文件时显示文件名，让用户确认自己选对了
    sourceLabel: '',
    parsing: false,
    // 同名菜怎么处理：skip 跳过（默认，最保守）| update 覆盖
    mode: 'skip',
    rows: [],
    errors: [],
    stats: null,
    hasSame: false,
    shownRows: [],
    moreRows: 0,
    importing: false,
    result: null,
    // 解析结果里的提示文案（分隔符、空结果原因…）
    hint: '',
    menuCount: 0,
    // 拉菜单失败：预览里的「同名菜」判断可能不准，页面上要看得见
    existingFailed: false,
    // 格式说明（从常量派生，避免和实际可选项漂移）
    categoryHint: CATEGORIES.map(function (c) {
      return c.key
    }).join(' / '),
    spiceHint: SPICE_LEVELS.map(function (s) {
      return s.key
    }).join(' / '),
    nameMax: csv.NAME_MAX,
    descMax: csv.DESC_MAX,
    importMax: csv.IMPORT_MAX,
  },

  onLoad() {
    this.existing = []
    this.rawText = ''
    this.writes = []
    // 「菜单是否已就绪」的 Promise：解析前必须 await 它。
    // 不 await 的话，用户手快在菜单拉回来之前就粘贴解析 —— 此时 existing 还是空数组，
    // 所有同名菜都会被判成「新增」，用户看到的预览是错的（「更新」被报成「新增」）。
    this.existingReady = this.loadExisting()
  },

  async loadExisting() {
    try {
      const res = await api.call('listDishes')
      this.existing = res.dishes || []
      this.existingFailed = false
      this.setData({ menuCount: this.existing.length, existingFailed: false })
    } catch (err) {
      // 读不到现有菜单不影响「能不能导入」，但会让同名菜失去判据 —— 记下失败，
      // 解析时明确告诉用户「这份预览的同名判断可能不准」，而不是静默给个错的结果。
      console.warn('[dish-import] 读菜单失败', err)
      this.existing = []
      this.existingFailed = true
      this.setData({ menuCount: 0, existingFailed: true })
    }
  },

  /**
   * 解析前确保菜单已就绪。
   * 首次进页面时 loadExisting 可能还在飞；失败过的话再给一次机会（本地读失败多半是暂时的）。
   * @returns {Promise<Array>} 现有菜单（拿不到时是空数组，但 existingFailed 会是 true）
   */
  async ensureExisting() {
    if (this.existingReady) {
      try {
        await this.existingReady
      } catch (e) {
        // loadExisting 内部已经兜住，这里只防御 Promise 意外 reject
      }
    }
    if (this.existingFailed) await this.loadExisting()
    return this.existing || []
  },

  // ---------- 入口一：从微信聊天选文件 ----------

  onPickFile() {
    if (typeof wx === 'undefined' || typeof wx.chooseMessageFile !== 'function') {
      ui.toast('这个版本不支持选文件，改用下面的粘贴吧')
      return
    }
    const self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt'],
      success(res) {
        const file = res && res.tempFiles && res.tempFiles[0]
        if (!file) return
        self.readFile(file)
      },
      fail(err) {
        // 用户主动取消不算错，别弹提示打扰
        if (err && /cancel/i.test(err.errMsg || '')) return
        console.warn('[dish-import] 选文件失败', err)
        ui.toast('没读到这个文件，再试一次')
      },
    })
  },

  readFile(file) {
    const self = this
    const fs =
      typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function'
        ? wx.getFileSystemManager()
        : null
    if (!fs || typeof fs.readFile !== 'function') {
      ui.toast('读不了文件，改用粘贴吧')
      return
    }
    ui.showLoading('正在读文件…')
    fs.readFile({
      filePath: file.path,
      encoding: 'utf-8',
      success(res) {
        ui.hideLoading()
        self.applyText(res.data, file.name || '选中的文件')
      },
      fail(err) {
        ui.hideLoading()
        console.error('[dish-import] 读文件失败', err)
        ui.toast('文件读不出来了，可能是格式不对')
      },
    })
  },

  // ---------- 入口二：读剪贴板 ----------

  onReadClipboard() {
    if (typeof wx === 'undefined' || typeof wx.getClipboardData !== 'function') {
      ui.toast('这个版本读不了剪贴板，手动粘一下吧')
      return
    }
    const self = this
    wx.getClipboardData({
      success(res) {
        const text = (res && res.data) || ''
        if (!String(text).trim()) {
          ui.toast('剪贴板里是空的')
          return
        }
        self.applyText(text, '剪贴板')
      },
      fail(err) {
        console.warn('[dish-import] 读剪贴板失败', err)
        ui.toast('读不到剪贴板，手动粘一下吧')
      },
    })
  },

  // ---------- 入口三：手动粘贴 ----------

  onPasteInput(e) {
    this.setData({ pasteText: e.detail.value })
  },

  onParse() {
    this.applyText(this.data.pasteText, '')
  },

  // ---------- 解析 ----------

  /**
   * 统一入口：拿到一段文本 → 解析 → 进预览。
   * 切换「同名怎么处理」时也会回到这里重解析（因为它会改变每一行的去留）。
   */
  async applyText(text, sourceLabel) {
    const raw = String(text == null ? '' : text)
    if (!raw.trim()) {
      ui.toast('内容还是空的')
      return
    }
    if (raw.length > csv.TEXT_MAX) {
      ui.toast('内容太长了，一次别超过 ' + csv.TEXT_MAX / 10000 + ' 万字符')
      return
    }
    // Excel 在中文 Windows 上默认存 GBK，按 utf-8 读出来会是满屏「�」
    if (raw.indexOf('\ufffd') >= 0) {
      ui.toast('文字乱码了，请把文件存成 UTF-8 编码再试')
      return
    }

    // 解析要靠 existing 认「同名菜」——所以必须等菜单就绪再解析。
    // 否则菜单还没拉回来时，所有同名菜都会被当成「新增」，预览是错的。
    const existing = await this.ensureExisting()

    this.rawText = raw

    let res = null
    try {
      res = csv.parseDishes(raw, { existing: existing, mode: this.data.mode })
    } catch (err) {
      console.error('[dish-import] 解析失败', err)
      ui.toast('这段内容没解析出来，检查一下格式')
      return
    }

    this.writes = res.writes

    const sepText = res.delimiter === '\t' ? '制表符分隔（从 Excel 复制的）' : '逗号分隔'
    let hint = '识别为' + sepText + '，现有菜单 ' + existing.length + ' 道'
    if (!res.writes.length && res.emptyReason) hint = res.emptyReason
    // 菜单没拉回来 → 同名判断没有依据，这份预览必须打上警告，不能让用户误以为是对的
    if (this.existingFailed) hint = '⚠️ 菜单没拉回来，同名菜可能被算成「新增」 · ' + hint

    this.setData({
      stage: 'preview',
      sourceLabel: sourceLabel || this.data.sourceLabel,
      rows: res.rows,
      errors: res.errors,
      stats: res.stats,
      hasSame: res.hasSame,
      hint: hint,
    })
    this.sliceRows()
  },

  // 预览只渲染前 N 行，剩下的给个「还有多少行」的提示
  sliceRows() {
    const rows = this.data.rows || []
    this.setData({
      shownRows: rows.slice(0, PREVIEW_PAGE),
      moreRows: Math.max(rows.length - PREVIEW_PAGE, 0),
    })
  },

  // 切换「同名菜」的处理方式 → 必须重解析
  onSetMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.mode) return
    this.setData({ mode: mode })
    if (this.rawText) this.applyText(this.rawText, this.data.sourceLabel)
  },

  // 回上一步重选内容
  onReset() {
    this.rawText = ''
    this.writes = []
    this.setData({
      stage: 'input',
      rows: [],
      shownRows: [],
      errors: [],
      stats: null,
      hasSame: false,
      moreRows: 0,
      result: null,
      hint: '',
      pasteText: '',
      sourceLabel: '',
    })
  },

  // ---------- 导入 ----------

  async onImport() {
    if (this.data.importing) return
    const items = this.writes || []
    if (!items.length) {
      ui.toast('这批没有能写入的菜')
      return
    }
    this.setData({ importing: true })
    ui.showLoading('正在写进菜单…')
    try {
      const res = await api.call('importDishes', { items: items })
      ui.hideLoading()
      this.setData({
        stage: 'result',
        importing: false,
        result: {
          added: res.added || 0,
          updated: res.updated || 0,
          skipped: res.skipped || 0,
          total: res.total || 0,
        },
      })
      ui.toast('导入完成 🎉', 'success')
    } catch (err) {
      ui.hideLoading()
      console.error('[dish-import] 导入失败', err)
      this.setData({ importing: false })
      ui.toast((err && err.message) || '没导进去，再试一次')
    }
  },

  // ---------- 模板 / 导出 ----------

  onCopyTemplate() {
    this.copyText(csv.templateText(), '模板已复制，粘到电脑上改吧')
  },

  // 把当前菜单导出来 → 在电脑上改完再导回去（也方便备份）
  //
  // 用 TSV 而不是 CSV：剪贴板里的内容多半是往 Excel 里粘的，
  // 只有制表符会让 Excel 自动分列，逗号会整段挤进一个格子。
  // 解析器两种分隔符都认，所以导回来照样能用。
  onCopyMenu() {
    if (!this.existing.length) {
      ui.toast('菜单还是空的，没东西可导出')
      return
    }
    this.copyText(csv.buildTSV(this.existing), '已复制，粘到表格里会自动分列')
  },

  copyText(text, tip) {
    if (typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') {
      ui.toast('这个版本复制不了')
      return
    }
    wx.setClipboardData({
      data: text,
      success() {
        ui.toast(tip, 'success')
      },
      fail() {
        ui.toast('复制失败了')
      },
    })
  },

  // 导完回菜单看一眼（菜单页 onShow 会自己重载）
  onBackToMenu() {
    wx.navigateBack()
  },
})
