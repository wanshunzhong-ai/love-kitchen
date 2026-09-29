// 把 templates/爱心小厨房-加菜模板.csv 里的菜品并进内置菜单 data/dishes.js
//
// 用法：node scripts/merge-template-dishes.js
//
// 规则（与应用内 importDishes 的默认模式一致）：
//   · 与现有菜单**同名**的菜跳过（保留 seed 里描述更全的版本），不报错；
//   · 新菜 id 从 seed 最大 id + 1 续（纯数字，购物车 Number(id) 依赖这条约定）；
//   · created_at 用固定基数 + 序号递增（列表按 created_at 升序，新菜排在 seed 后面，
//     且重跑脚本结果完全一致，不会每次都变）。
//
// 顺带把 templates/爱心小厨房-当前菜单.csv 重新导出成合并后的完整菜单。
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const csv = require(path.join(ROOT, 'utils/csv.js'))

const SEED_PATH = path.join(ROOT, 'data/dishes.js')
const TPL_PATH = path.join(ROOT, 'templates/爱心小厨房-加菜模板.csv')
const MENU_PATH = path.join(ROOT, 'templates/爱心小厨房-当前菜单.csv')

const seed = require(SEED_PATH)
const parsed = csv.parseDishes(fs.readFileSync(TPL_PATH, 'utf8'))
if (!parsed.ok || !parsed.writes.length) {
  console.error('模板解析失败：', parsed.emptyReason || (parsed.errors || []).slice(0, 5))
  process.exit(1)
}
console.log('模板解析出 ' + parsed.writes.length + ' 道菜，错误 ' + parsed.errors.length + ' 条')

// 同名跳过（与 parseDishes 的索引规则一致：trim + 小写）
const byName = {}
seed.forEach(function (d) { byName[String(d.name).trim().toLowerCase()] = true })

let maxId = seed.reduce(function (m, d) { return Math.max(m, Number(d.id) || 0) }, 0)
const BASE_TS = 1790563758527 // 与 seed 同量级的固定基数，保证确定性
const added = []
let skipped = 0
parsed.writes.forEach(function (d, i) {
  const key = String(d.name).trim().toLowerCase()
  if (byName[key]) { skipped += 1; return }
  maxId += 1
  added.push({
    id: maxId,
    name: d.name,
    category: d.category,
    emoji: d.emoji,
    spice: d.spice,
    description: d.description,
    created_at: BASE_TS + 1000 + i,
  })
  byName[key] = true
})
console.log('跳过同名 ' + skipped + ' 道，新增 ' + added.length + ' 道，新 id ' + (maxId - added.length + 1) + '..' + maxId)

const merged = seed.concat(added)
console.log('合并后共 ' + merged.length + ' 道')

// 重写 data/dishes.js（每行一道，key 顺序与原文件一致）
const lines = merged.map(function (d) {
  return '  ' + JSON.stringify({
    id: d.id,
    name: d.name,
    category: d.category,
    emoji: d.emoji,
    spice: d.spice,
    description: d.description,
    created_at: d.created_at,
  }) + ','
})
const head =
  '// 爱心小厨房 · 内置菜品数据（共 ' + merged.length + ' 道）\n' +
  '// 由 scripts/merge-template-dishes.js 从 templates/爱心小厨房-加菜模板.csv 合并生成，请勿手工编辑；\n' +
  '// 改菜请在应用内新增/编辑（会存到本地覆盖层）。\n' +
  '// 注意：id 必须为纯数字 —— pages/checkout/checkout.js 用 Number(dataset.id) 做购物车加减，\n' +
  '//       字符串 id 会得到 NaN 导致加减失效。\n' +
  'module.exports = [\n'
fs.writeFileSync(SEED_PATH, head + lines.join('\n') + '\n]\n', 'utf8')
console.log('已写入 ' + path.relative(ROOT, SEED_PATH))

// 重新导出「当前菜单」CSV（BOM + CRLF，Excel 双击不乱码）
fs.writeFileSync(MENU_PATH, '\uFEFF' + csv.buildCSV(merged).replace(/\n/g, '\r\n') + '\r\n', 'utf8')
console.log('已重新导出 ' + path.relative(ROOT, MENU_PATH))

// 分类分布
const cat = {}
merged.forEach(function (d) { cat[d.category] = (cat[d.category] || 0) + 1 })
console.log('分类分布:', JSON.stringify(cat))
