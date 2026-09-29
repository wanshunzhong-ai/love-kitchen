// 爱心小厨房 · CSV / TSV 批量加菜
//
// 为什么不用「上传文件解析」那套：小程序没有通用文件下载/选择能力，
// 拿到内容的可靠途径只有两条 ——
//   1) wx.chooseMessageFile 从微信聊天里选文件（用户得先发给自己）
//   2) 剪贴板 / 文本框粘贴
// 而「从 Excel 复制一列出来粘贴」恰好是第二条，且 Excel 复制出来是 **制表符分隔**，
// 所以这里同时支持 CSV（逗号）与 TSV（制表符），自动识别，不让用户去操心分隔符。
//
// 全文件纯函数（不碰 wx / 不发请求），因此可以被 node 直接跑契约测试。
//
// 字段规则与 pages/dish-edit 完全一致，导进来的菜和手加的一模一样：
//   菜名 ≤ 20 字、介绍 ≤ 60 字、分类必须是 CATEGORIES 里的、辣度必须是 SPICE_LEVELS 里的。

const { CATEGORIES, SPICE_LEVELS } = require('./constants')

// 一次最多导入多少道（防手滑把几万行粘进来把本地存储写爆）
const IMPORT_MAX = 500 // 菜单已有 300+ 道，整份「当前菜单」导回也不能被截断
// 与 pages/dish-edit 的输入框上限保持一致
const NAME_MAX = 20
const DESC_MAX = 60
// 预览区最多列多少行（再多折叠，页面不至于卡）
const PREVIEW_MAX = 30

const CATEGORY_KEYS = CATEGORIES.map(function (c) {
  return c.key
})
const SPICE_KEYS = SPICE_LEVELS.map(function (s) {
  return s.key
})

// ---------------------------------------------------------------------------
// 1. 分隔符识别
// ---------------------------------------------------------------------------

// 注释行前缀：以 # 开头的行整行忽略
//
// 为什么需要它：「复制模板」给出去的说明文字必须能和表格放进同一份文本里，
// 否则用户把整段直接粘回输入框时，说明文字会被当成一道道菜**悄悄导进去**
// （每行第一格「菜名：必填」这种恰好没超长，解析器不会报错，于是变成了
//   9 道垃圾菜 —— 这种失败方式最难发现）。加了注释约定之后，
//   说明留在原地，解析器跳过，用户爱粘哪里都对。
const COMMENT_PREFIX = '#'

/** 这一行是不是注释行（只看第一格是否以 # 开头） */
function isCommentRow(cells) {
  const first = cells && cells.length ? String(cells[0] == null ? '' : cells[0]).trim() : ''
  return first.charAt(0) === COMMENT_PREFIX
}

/**
 * 猜分隔符：首个有效行里制表符多就用 TSV，否则用 CSV。
 * 为什么要猜：Excel / WPS 复制出来是 TSV，手敲的文件一般是 CSV，
 * 让用户先选一次分隔符，错一次就白导一遍。
 *
 * 注意要跳过注释行与空行再嗅探：注释是「人话」，里面常带逗号，
 * 拿它去数分隔符会把一份 TSV 判成 CSV，整份文件就只剩一列了。
 * @param {string} text
 * @returns {','|'\t'}
 */
function detectDelimiter(text) {
  const lines = String(text == null ? '' : text).split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.trim().charAt(0) === COMMENT_PREFIX) continue
    const tabs = (line.match(/\t/g) || []).length
    const commas = (line.match(/,/g) || []).length
    if (tabs === 0 && commas === 0) return ','
    return tabs > commas ? '\t' : ','
  }
  return ','
}

// ---------------------------------------------------------------------------
// 2. CSV 本体解析（手写状态机）
// ---------------------------------------------------------------------------

/**
 * 按分隔符切表。支持：
 *   · 双引号包裹的字段（字段里可以带分隔符、换行、逗号）
 *   · 字段内的双引号用 "" 转义
 *   · CRLF / LF / CR 三种换行
 *   · 文件头 BOM
 * @param {string} text
 * @param {string} delim
 * @returns {string[][]} 原始单元格（未 trim）
 */
function splitRows(text, delim) {
  let s = String(text == null ? '' : text)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1) // 去掉 UTF-8 BOM

  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch === '\r') {
      // \r\n 交给后面的 \n 处理；孤立 \r（老 Mac）在这里断行
      if (s[i + 1] !== '\n') {
        row.push(cell)
        rows.push(row)
        row = []
        cell = ''
      }
    } else {
      cell += ch
    }
  }
  row.push(cell)
  rows.push(row)

  // 去掉整行都是空的行（文件末尾的空行、中间的空行都会落到这里）
  const out = []
  rows.forEach(function (cells) {
    const trimmed = cells.map(function (c) {
      return String(c).trim()
    })
    const empty = trimmed.every(function (c) {
      return c === ''
    })
    if (!empty) out.push(trimmed)
  })
  return out
}

/**
 * 每个解析行对应的「原文物理行号」（从 1 起）。
 *
 * 为什么要单独算：报错要说「第几行有问题」，用户才会拿着行号去文件里改。
 * 行号不能用数组下标代替 —— 注释行被丢掉了（整体前移），而引号里的换行
 * 又会让一个解析行跨好几个物理行（整体后移），两种偏差叠起来
 * 能把「第 3 行」报成「第 12 行」。
 * @param {string[][]} rows
 * @returns {number[]}
 */
function lineNumbersOf(rows) {
  const out = []
  let line = 1
  rows.forEach(function (cells) {
    out.push(line)
    let span = 1
    cells.forEach(function (c) {
      const s = String(c == null ? '' : c)
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '\n') span++
      }
    })
    line += span
  })
  return out
}

/**
 * 解析成表格 + 识别表头。
 *
 * 注释行（首格以 # 开头）在这里就被整行丢掉：不能留到后面再跳过，
 * 否则一行注释当头会把 detectHeader 判成「没有表头」，整份文件按固定列序读 → 错位。
 * @param {string} text
 * @returns {{ rows: string[][], lines: number[], delimiter: string, header: Object|null, body: string[][], bodyLines: number[] }}
 */
function parseTable(text) {
  const delimiter = detectDelimiter(text)
  const all = splitRows(text, delimiter)
  const allLines = lineNumbersOf(all)
  const rows = []
  const lines = []
  all.forEach(function (cells, i) {
    if (isCommentRow(cells)) return
    rows.push(cells)
    lines.push(allLines[i])
  })
  const header = rows.length ? detectHeader(rows[0]) : null
  const body = header ? rows.slice(1) : rows
  return {
    rows: rows,
    lines: lines,
    delimiter: delimiter,
    header: header,
    // 有表头就跳过第一行；没有表头按固定列序
    body: body,
    bodyLines: header ? lines.slice(1) : lines,
  }
}

// 表头别名。中英文都收，大小写与空格会被归一化。
const HEADER_ALIASES = {
  name: ['菜名', '名称', '菜品', '菜品名称', 'name', 'dish', 'dishname'],
  category: ['分类', '类别', 'category', 'type'],
  emoji: ['图标', '表情', 'emoji', 'icon'],
  spice: ['辣度', '口味', 'spice', 'hot'],
  description: ['介绍', '描述', '说明', '简介', '备注', 'description', 'desc', 'intro', 'note'],
}

// 没有表头时的列序约定
const POSITIONAL = { name: 0, category: 1, emoji: 2, spice: 3, description: 4 }

/**
 * 判断首行是不是表头，是就返回「字段 → 列号」映射。
 *
 * 判据：必须认出「菜名」这一列。之所以不要求认出更多列，是因为
 * 「菜名,辣度」这种两列文件也该算有表头；而反过来，
 * 无表头文件的第一行第一个格子恰好写着「菜名」的概率极低，
 * 真出现的话预览页也会明确显示出来，用户点一下重选就行。
 * @param {string[]} cells
 * @returns {Object|null}
 */
function detectHeader(cells) {
  const map = {}
  let hits = 0
  cells.forEach(function (cell, i) {
    const key = String(cell == null ? '' : cell)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
    if (!key) return
    Object.keys(HEADER_ALIASES).forEach(function (field) {
      if (map[field] !== undefined) return
      if (HEADER_ALIASES[field].indexOf(key) >= 0) {
        map[field] = i
        hits++
      }
    })
  })
  return map.name !== undefined ? map : null
}

// ---------------------------------------------------------------------------
// 3. 字段规整（把一行「人话」收拾成菜品对象）
// ---------------------------------------------------------------------------

/** 分类 → 默认图标（用户没填图标时用它） */
function defaultEmoji(category) {
  const hit = CATEGORIES.find(function (c) {
    return c.key === category
  })
  return hit ? hit.emoji : '🍴'
}

/**
 * 这个字符串像不像一个 emoji。
 * 不做完整 Unicode 判定（小程序内核差异大），只挡「明显是文字」的输入 ——
 * 比如用户在图标列写了「红烧」两个字，那还不如给个默认图标。
 */
function looksLikeEmoji(s) {
  if (!s) return false
  const cp = s.codePointAt(0)
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) || // 各类图形符号（食物、人物、手势…）
    (cp >= 0x2600 && cp <= 0x27bf) || // 杂项符号与装饰符
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x2190 && cp <= 0x21ff) ||
    cp === 0xfe0f
  )
}

/** 数一数字符串里有几颗辣椒，用于「🌶️🌶️」这种没写明档位的辣度 */
function chiliCount(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s.codePointAt(i) === 0x1f336) {
      n++
      i++ // 跳过低位代理
    }
  }
  return n
}

/**
 * 把一行原始字段收拾成合法的菜品对象。
 *
 * 设计取向：**尽量收进来，而不是报错弹回去**。
 * 分类写错了归到「其他」、辣度写错了按辣椒数量猜，都记进 notes 让用户在预览里看见；
 * 只有「没有菜名」才真的算错（没名字的菜没法点单）。
 *
 * @param {object} raw { name, category, emoji, spice, description }
 * @returns {{ ok: boolean, dish?: object, notes?: string[], reason?: string }}
 */
function sanitizeDish(raw) {
  const src = raw || {}
  const notes = []

  const rawName = String(src.name == null ? '' : src.name).trim()
  if (!rawName) return { ok: false, reason: '没有菜名' }
  const name = rawName.length > NAME_MAX ? rawName.slice(0, NAME_MAX) : rawName
  if (name !== rawName) notes.push('菜名超过 ' + NAME_MAX + ' 字，已截断')

  // --- 分类 ---
  const rawCat = String(src.category == null ? '' : src.category).trim()
  let category = ''
  if (!rawCat) {
    category = CATEGORIES[0].key
  } else if (CATEGORY_KEYS.indexOf(rawCat) >= 0) {
    category = rawCat
  } else {
    // 容错：把分类列写成「🍖 经典热菜」也能认出来
    const hit = CATEGORY_KEYS.find(function (k) {
      return rawCat.indexOf(k) >= 0
    })
    if (hit) {
      category = hit
    } else {
      category = CATEGORY_KEYS[CATEGORY_KEYS.length - 1] // 「其他」
      notes.push('分类「' + rawCat + '」不在菜单分类里，归到「其他」')
    }
  }

  // --- 辣度 ---
  const rawSpice = String(src.spice == null ? '' : src.spice).trim()
  let spice = ''
  if (!rawSpice) {
    spice = '不辣'
  } else if (SPICE_KEYS.indexOf(rawSpice) >= 0) {
    spice = rawSpice
  } else {
    const hit = SPICE_KEYS.find(function (k) {
      return rawSpice.indexOf(k) >= 0
    })
    if (hit) {
      spice = hit
    } else {
      const n = chiliCount(rawSpice)
      spice = n >= 3 ? '特辣' : n === 2 ? '中辣' : n === 1 ? '微辣' : '不辣'
      notes.push('辣度「' + rawSpice + '」不认识，按「' + spice + '」处理')
    }
  }

  // --- 图标 ---
  const rawEmoji = String(src.emoji == null ? '' : src.emoji).trim()
  let emoji = ''
  if (!rawEmoji) {
    emoji = defaultEmoji(category)
  } else if (rawEmoji.length > 8 || !looksLikeEmoji(rawEmoji)) {
    emoji = defaultEmoji(category)
    notes.push('图标「' + rawEmoji.slice(0, 6) + '」不像表情，换成了默认图标')
  } else {
    emoji = rawEmoji
  }

  // --- 介绍 ---
  const rawDesc = String(src.description == null ? '' : src.description).trim()
  const description = rawDesc.length > DESC_MAX ? rawDesc.slice(0, DESC_MAX) : rawDesc
  if (description !== rawDesc) notes.push('介绍超过 ' + DESC_MAX + ' 字，已截断')

  return {
    ok: true,
    dish: { name: name, category: category, emoji: emoji, spice: spice, description: description },
    notes: notes,
  }
}

// ---------------------------------------------------------------------------
// 4. 主入口：文本 → 可导入清单
// ---------------------------------------------------------------------------

function emptyStats() {
  return { add: 0, update: 0, skip: 0, error: 0, total: 0 }
}

/**
 * 解析一份 CSV/TSV 文本，产出「预览行 + 真正要写的清单」。
 *
 * @param {string} text
 * @param {object} [options]
 * @param {Array}  [options.existing] 当前菜单（用于识别同名菜）
 * @param {string} [options.mode]     'skip'（同名跳过，默认）| 'update'（同名覆盖）
 * @returns {{
 *   ok: boolean, rows: Array, writes: Array, errors: Array,
 *   stats: object, hasSame: boolean, delimiter: string,
 *   previewMax: number, emptyReason?: string
 * }}
 *   rows   = 预览用（每行都带 line / action / reason，最多 PREVIEW_MAX 条）
 *   writes = 提交给 importDishes 的（只有 add 与 update，跳过的不进）
 */
function parseDishes(text, options) {
  const opts = options || {}
  const mode = opts.mode === 'update' ? 'update' : 'skip'
  const existing = Array.isArray(opts.existing) ? opts.existing : []

  const table = parseTable(text)
  const empty = {
    ok: false,
    rows: [],
    writes: [],
    errors: [],
    stats: emptyStats(),
    hasSame: false,
    delimiter: table.delimiter,
    previewMax: PREVIEW_MAX,
    emptyReason: '内容里没有可识别的行',
  }
  if (!table.body.length) return empty

  // 现有菜单按菜名索引（同名只取第一条，剩下的当作不存在）
  const byName = {}
  existing.forEach(function (d) {
    const k = String(d.name == null ? '' : d.name)
      .trim()
      .toLowerCase()
    if (k && byName[k] === undefined) byName[k] = d
  })

  const rows = []
  const writes = []
  const errors = []
  const stats = emptyStats()
  const seenLine = {} // 本文件内菜名 → 首次出现行号
  let hasSame = false
  let overflow = false

  for (let i = 0; i < table.body.length; i++) {
    const cells = table.body[i]
    // 行号按「用户在文件里看到的那一行」算：由 parseTable 记录的真实物理行号，
    // 注释行与引号内换行都已经被它算进去了
    const line = table.bodyLines[i]

    if (stats.add + stats.update + stats.skip >= IMPORT_MAX) {
      if (!overflow) {
        overflow = true
        errors.push({
          line: line,
          reason: '一次最多导入 ' + IMPORT_MAX + ' 道菜，这行之后先略过（可以分两次导）',
          raw: cells.join(' | '),
        })
      }
      continue
    }

    const raw = { name: '', category: '', emoji: '', spice: '', description: '' }
    const cols = table.header || POSITIONAL
    Object.keys(raw).forEach(function (field) {
      const ci = cols[field]
      raw[field] = ci === undefined ? '' : cells[ci]
    })

    const s = sanitizeDish(raw)
    stats.total++
    if (!s.ok) {
      stats.error++
      errors.push({ line: line, reason: s.reason, raw: cells.join(' | ') })
      continue
    }

    const dish = s.dish
    const notes = (s.notes || []).slice()
    const key = dish.name.toLowerCase()

    // 文件内重名：只留第一条，后面那条告诉用户为什么没进来
    if (seenLine[key] !== undefined) {
      stats.skip++
      rows.push({
        line: line,
        name: dish.name,
        emoji: dish.emoji,
        category: dish.category,
        spice: dish.spice,
        action: 'skip',
        reason: '和本文件第 ' + seenLine[key] + ' 行重名，只留下前面那条',
        notes: notes,
      })
      hasSame = true
      continue
    }
    seenLine[key] = line

    const hit = byName[key]
    if (hit) {
      hasSame = true
      if (mode === 'update') {
        stats.update++
        const w = Object.assign({ id: Number(hit.id) }, dish)
        writes.push(w)
        rows.push({
          line: line,
          name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          spice: dish.spice,
          action: 'update',
          reason: '菜单里已有同名菜，会更新它（id ' + hit.id + '）',
          notes: notes,
        })
      } else {
        stats.skip++
        rows.push({
          line: line,
          name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          spice: dish.spice,
          action: 'skip',
          reason: '菜单里已经有「' + hit.name + '」了，这次不动它',
          notes: notes,
        })
      }
      continue
    }

    stats.add++
    writes.push(dish)
    rows.push({
      line: line,
      name: dish.name,
      emoji: dish.emoji,
      category: dish.category,
      spice: dish.spice,
      action: 'add',
      reason: '',
      notes: notes,
    })
  }

  return {
    ok: writes.length > 0,
    rows: rows,
    writes: writes,
    errors: errors,
    stats: stats,
    hasSame: hasSame,
    delimiter: table.delimiter,
    previewMax: PREVIEW_MAX,
    emptyReason: writes.length ? '' : '这一批没有可以写入的菜',
  }
}

// ---------------------------------------------------------------------------
// 5. 导出与模板（让用户可以「导出 → 在电脑上改 → 再导回来」）
// ---------------------------------------------------------------------------

function escapeCell(v) {
  const s = String(v == null ? '' : v)
  return /[",\n\r\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

const EXPORT_HEAD = ['菜名', '分类', '图标', '辣度', '介绍']

/** 菜品数组 → 表格文本（含表头），分隔符由调用方给 */
function buildRows(dishes, sep) {
  const lines = [EXPORT_HEAD.join(sep)]
  ;(dishes || []).forEach(function (d) {
    lines.push(
      [d.name, d.category, d.emoji, d.spice, d.description || '']
        .map(escapeCell)
        .join(sep)
    )
  })
  return lines.join('\n')
}

/**
 * 菜品数组 → CSV 文本（含表头）。字段顺序与模板一致。
 * @param {Array} dishes
 * @returns {string}
 */
function buildCSV(dishes) {
  return buildRows(dishes, ',')
}

/**
 * 菜品数组 → TSV 文本（制表符分隔，含表头）。
 *
 * 「复制菜单 / 复制模板」走的是剪贴板，**必须用制表符**：
 * 粘到 Excel / WPS 里时只有制表符会分列，逗号文本会整段挤进一个格子，
 * 用户还得手动「数据 → 分列」。而我们的解析器两种都认（自动嗅探），
 * 所以改成分隔符不影响导回来。
 * @param {Array} dishes
 * @returns {string}
 */
function buildTSV(dishes) {
  return buildRows(dishes, '\t')
}

// 模板里的示例菜：挑三道覆盖不同分类与辣度，让用户一眼看懂每列该填什么
const TEMPLATE_SAMPLE = [
  { name: '番茄炒蛋', category: '经典热菜', emoji: '🍅', spice: '不辣', description: '酸甜下饭，十分钟搞定' },
  { name: '冬瓜排骨汤', category: '汤羹煲', emoji: '🍲', spice: '不辣', description: '清淡解腻，炖足一小时' },
  { name: '凉拌拍黄瓜', category: '凉菜腌腊', emoji: '🥒', spice: '微辣', description: '蒜香开胃，夏天必备' },
]

/** 模板 CSV 文本（表头 + 三道示例）—— 落文件用这个（选文件器只认 .csv） */
function templateCSV() {
  return buildCSV(TEMPLATE_SAMPLE)
}

/** 模板 TSV 文本 —— 复制到剪贴板用这个（粘进表格自动分列） */
function templateTSV() {
  return buildTSV(TEMPLATE_SAMPLE)
}

/**
 * 导出一份含「填写说明」的文本，供「复制模板」用。
 *
 * 说明行全部冠以 # —— 这不是装饰：用户完全可能把这整段直接粘回输入框
 * （「复制模板」→ 就在框里改 → 解析），没有注释约定的话那 9 行说明
 * 会被当成 9 道菜悄悄导进去。表格本体用制表符分隔，粘到 Excel 里直接分列。
 */
function templateText() {
  const cats = CATEGORY_KEYS.join(' / ')
  const spices = SPICE_KEYS.join(' / ')
  return [
    '# 【爱心小厨房 · 加菜模板】',
    '# 以 # 开头的行是说明，解析时会整行跳过，不会当成菜导进去。',
    '# 第一行表头别删；从表头下面开始，每行一道菜。',
    '# 菜名：必填，最多 ' + NAME_MAX + ' 字（重复的菜名会被识别成同一道菜）',
    '# 分类：' + cats,
    '# 图标：一个表情，比如 🍅；不填就按分类给默认图标',
    '# 辣度：' + spices + '（不填按不辣）',
    '# 介绍：可不填，最多 ' + DESC_MAX + ' 字',
    '#',
    '# —— 下面这些可以直接改成你的菜（介绍里含逗号、引号时用英文双引号包起来）——',
    templateTSV(),
  ].join('\n')
}

module.exports = {
  IMPORT_MAX,
  NAME_MAX,
  DESC_MAX,
  PREVIEW_MAX,
  COMMENT_PREFIX,
  HEADER_ALIASES,
  POSITIONAL,
  TEMPLATE_SAMPLE,
  detectDelimiter,
  splitRows,
  isCommentRow,
  lineNumbersOf,
  detectHeader,
  parseTable,
  sanitizeDish,
  defaultEmoji,
  looksLikeEmoji,
  chiliCount,
  parseDishes,
  buildRows,
  buildCSV,
  buildTSV,
  escapeCell,
  templateCSV,
  templateTSV,
  templateText,
}
