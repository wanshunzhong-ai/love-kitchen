/**
 * 生成「批量加菜」配套的 CSV 文件（模板 + 当前菜单导出）
 *
 * 注意：本文件第一行禁止写 shebang（#!/usr/bin/env node）。
 *   scripts/ 虽在上传包忽略名单里，但保持与 build-npm.js 一致的约定更省事。
 *   运行方式：node scripts/gen-csv-template.js
 *
 * 为什么要用脚本生成、而不是手写一份 csv 丢进 templates/：
 *   模板必须和「导出菜单」按钮吐出来的东西、以及 utils/csv.js 的解析器
 *   三边完全对齐。手写的那份迟早会漂移（列序改了、转义规则改了），
 *   而漂移的表现是用户导回来看到一堆莫名其妙的错误行 —— 极难排查。
 *   这里所有内容都从 utils/csv.js 现取，改了解析器重跑一次即可。
 *
 * 生成完请跑一遍校验：node .workbuddy/tmp/test_csv_template.js
 * （它会把这些文件再喂回解析器，逐个字段比对，确认往返不丢东西）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const csv = require(path.join(ROOT, 'utils', 'csv.js'))
const seed = require(path.join(ROOT, 'data', 'dishes.js'))
const { CATEGORIES } = require(path.join(ROOT, 'utils', 'constants.js'))

const OUT_DIR = path.join(ROOT, 'templates')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

/**
 * 写 CSV：加 UTF-8 BOM + 统一 CRLF。
 *
 * BOM 是关键。中文 Windows 的 Excel 双击打开不带 BOM 的 UTF-8 CSV 会按 GBK
 * 解码，满屏乱码 —— 用户只能绕去「数据 → 从文本/CSV 导入」手动选编码。
 * 带 BOM 后 Excel 自己就认出来了，双击即正确。
 * 我们的解析器本来就吃 BOM（splitRows 里已剥），所以加了对导回没有副作用。
 * CRLF 同理：Excel 对 LF 的兼容一直不太好。
 */
function writeCSV(file, text) {
  const body = text.replace(/\r?\n/g, '\r\n')
  const full = path.join(OUT_DIR, file)
  fs.writeFileSync(full, '\ufeff' + body + '\r\n', 'utf8')
  return fs.statSync(full).size
}

// 模板留几行空位，让人一眼看出「接着往下写」。
// 全空行会被解析器丢弃（splitRows 里 trim 后整行皆空则跳过），不会变成脏数据。
const BLANK_ROWS = 5
const templateBody = csv.templateCSV() + '\n' + new Array(BLANK_ROWS).fill(',,,,').join('\n')

const sizeTemplate = writeCSV('爱心小厨房-加菜模板.csv', templateBody)
const sizeMenu = writeCSV('爱心小厨房-当前菜单.csv', csv.buildCSV(seed))

// ---------------------------------------------------------------------------
// 填写说明
//
// 写成 .md 而不是 .txt：选文件时只允许 csv / txt 两种后缀，
// 用 .txt 的话用户可能手滑选中说明文件，把「填写说明」当数据导进来。
// ---------------------------------------------------------------------------
const guide = [
  '# 爱心小厨房 · 批量加菜填写说明',
  '',
  '| 文件 | 用途 |',
  '| --- | --- |',
  '| `爱心小厨房-加菜模板.csv` | 空白模板：表头 + 3 道示例，在示例下面接着写 |',
  '| `爱心小厨房-当前菜单.csv` | 现在菜单上的全部 ' + seed.length + ' 道菜，适合整体改名 / 改分类，改完直接导回来 |',
  '',
  '> 菜单有改动后，重跑 `node scripts/gen-csv-template.js` 重新生成这两个文件。',
  '',
  '## 列的含义',
  '',
  '| 列 | 必填 | 说明 |',
  '| --- | --- | --- |',
  '| 菜名 | 是 | 最多 ' + csv.NAME_MAX + ' 字。**同名会被认成同一道菜**，所以「番茄炒蛋」不会变成两份 |',
  '| 分类 | 否 | ' + CATEGORIES.map(function (c) { return c.key }).join(' / ') + '；写别的会归到「其他」 |',
  '| 图标 | 否 | 一个表情，比如 🍅；不填就按分类给默认图标 |',
  '| 辣度 | 否 | 不辣 / 微辣 / 中辣 / 特辣；不填按不辣，写 🌶️🌶️ 会按辣椒个数猜 |',
  '| 介绍 | 否 | 最多 ' + csv.DESC_MAX + ' 字。**超长会被截到 ' + csv.DESC_MAX + ' 字**，别当成长文本用 |',
  '',
  '## 怎么导进去',
  '',
  '小程序里进「菜单 → 📥 批量」，三条路任选：',
  '',
  '1. **从聊天选文件** —— 先把 csv 发到微信「文件传输助手」，再在这里选它',
  '2. **读剪贴板** —— 在电脑上打开表格、全选、复制，手机上一点就粘进来（**最顺手**，连文件都不用传）',
  '3. **直接粘**到文本框里',
  '',
  '进去之后先出预览（新增 x / 覆盖 y / 跳过 z / 有问题 k），确认无误再点导入。批量导入很难逐条撤销，看清楚再写。',
  '',
  '## 几个容易踩的点',
  '',
  '1. 第一行是表头，**别删**。认不出表头时按 `菜名 / 分类 / 图标 / 辣度 / 介绍` 的固定列序读，能用，但列一多容易错位。',
  '2. **列顺序可以换、也可以少列**，只要首行认得出「菜名」这一列（别名：名称 / 菜品 / name…）。',
  '3. **以 `#` 开头的行会被整行跳过**，可以拿它写注释、留说明 —— 「复制模板」给出的说明就是靠这个才敢和表格放在一起。',
  '4. 介绍里带逗号、引号或换行的格子，要用英文双引号把整个格子包起来（Excel 导出时会自动处理，手写时注意）。',
  '5. 一次最多 ' + csv.IMPORT_MAX + ' 道，超了会被拦下（防手滑粘几万行把本地存储写爆）。',
  '6. 存文件时选 **UTF-8**。用 WPS / 记事本改一般没问题；Excel「另存为 CSV」在中文系统上默认是 GBK，导进去会满屏乱码（页面会直接提示你另存为 UTF-8）。',
  '7. 带 `id` 列会被当成「更新那道菜」；不带 id 时按菜名匹配，**找到就更新它**，不会造出第二份同名菜。',
  '8. 报错里的行号是**文件里的真实行号**（注释行、引号里的换行都算进去了），拿着它直接去文件里找就行。',
  '9. 这两个文件在 `templates/` 目录里，已加进上传包忽略名单（`project.config.json` 的 `packOptions.ignore`），不会被包进小程序。',
  '',
  '## 关于分隔符',
  '',
  '| 从哪来 | 分隔符 | 能不能直接用 |',
  '| --- | --- | --- |',
  '| 这两个 .csv 文件 | 逗号 | 能（选文件导入） |',
  '| Excel / WPS 里全选复制 | 制表符 | 能（读剪贴板，**推荐**） |',
  '| 小程序里的「复制模板 / 导出菜单」 | 制表符 | 能，而且粘进表格会**自动分列**（用逗号的话会整段挤进一个格子） |',
  '',
].join('\n')

fs.writeFileSync(path.join(OUT_DIR, '填写说明.md'), guide, 'utf8')

console.log('已生成 ' + OUT_DIR)
console.log('  · 爱心小厨房-加菜模板.csv   ' + sizeTemplate + ' B')
console.log('  · 爱心小厨房-当前菜单.csv   ' + sizeMenu + ' B（' + seed.length + ' 道菜）')
console.log('  · 填写说明.md')
console.log('\n改完记得跑：node .workbuddy/tmp/test_csv_template.js')
