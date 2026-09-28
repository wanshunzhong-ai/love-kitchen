#!/usr/bin/env node
/**
 * 生成 miniprogram_npm 构建产物（等价于开发者工具的「构建 npm」）
 *
 * 为什么需要这个脚本：
 *   微信小程序不能直接 require node_modules，必须经过「构建 npm」得到
 *   miniprogram_npm/。正常情况下这一步由开发者工具完成，但本项目的 SDK
 *   恰好是「自包含单文件」（rollup 已把 adapter / core-js-pure 等依赖全部内联，
 *   入口内零 require），因此可以按官方产物规范离线复现，免去用户手工点击。
 *
 * 官方规范（见 developers.weixin.qq.com/miniprogram/dev/devtools/npm.html）：
 *   普通 npm 包 → miniprogram_npm/<包名>/index.js（打包后的单文件）
 *   入口默认取 index.js（package.json 的 main 也可指定）
 *
 * 用法：node scripts/build-npm.js
 * 何时需要跑：升级 @cloudbase/wx-cloud-client-sdk 版本后
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PKG = '@cloudbase/wx-cloud-client-sdk'

const srcPkgJsonPath = path.join(ROOT, 'node_modules', PKG, 'package.json')
const outDir = path.join(ROOT, 'miniprogram_npm', PKG)
const outEntry = path.join(outDir, 'index.js')

function fail(msg) {
  console.error('[build-npm] 失败：' + msg)
  process.exit(1)
}

if (!fs.existsSync(srcPkgJsonPath)) {
  fail('没找到 ' + PKG + '，请先在项目根目录执行 npm install')
}

const srcPkg = JSON.parse(fs.readFileSync(srcPkgJsonPath, 'utf8'))
const entryRel = srcPkg.main || 'index.js'
const srcEntryPath = path.join(ROOT, 'node_modules', PKG, entryRel)

if (!fs.existsSync(srcEntryPath)) {
  fail('入口文件不存在：' + srcEntryPath)
}

const code = fs.readFileSync(srcEntryPath, 'utf8')

// 自检：入口里若还有 require('xxx') 形式的「非相对路径」依赖，
// 说明它不再自包含，需要改走真正的打包流程（开发者工具「构建 npm」）。
const externalReqs = []
const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g
let m
while ((m = re.exec(code)) !== null) {
  const dep = m[1]
  // 相对路径 / 绝对路径的依赖可接受（但仍应尽量内联），包名形式必须报错
  if (dep[0] !== '.' && dep[0] !== '/') externalReqs.push(dep)
}
if (externalReqs.length) {
  fail(
    '入口文件仍有外部依赖，无法直接复制：' +
      Array.from(new Set(externalReqs)).join(', ') +
      '\n         请改用开发者工具的「工具 → 构建 npm」生成产物。'
  )
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outEntry, code, 'utf8')
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: srcPkg.name,
      version: srcPkg.version,
      description: srcPkg.description || '',
      main: 'index.js',
    },
    null,
    2
  ) + '\n',
  'utf8'
)

console.log('[build-npm] 完成：')
console.log('  ' + path.relative(ROOT, outEntry).replace(/\\/g, '/'))
console.log('  ' + path.relative(ROOT, path.join(outDir, 'package.json')).replace(/\\/g, '/'))
console.log('  版本 ' + srcPkg.version + '，自包含单文件（无外部 require）')
