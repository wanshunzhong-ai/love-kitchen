/**
 * 生成 miniprogram_npm 构建产物（等价于开发者工具的「构建 npm」）
 *
 * 注意：本文件第一行禁止写 shebang（#!/usr/bin/env node）。
 *   小程序项目的上传包可能整目录打包，shebang 是 Node 专用语法，
 *   微信打包器会报 SyntaxError: Invalid or unexpected token 导致上传失败。
 *   本脚本用 `node scripts/build-npm.js` 运行，无需 shebang。
 *
 * 为什么需要这个脚本：
 *   微信小程序不能直接 require node_modules，必须经过「构建 npm」得到
 *   miniprogram_npm/。正常情况下这一步由开发者工具完成，但本项目的两个 SDK
 *   恰好都是「自包含单文件」（rollup 已把依赖全部内联，入口内零 require），
 *   因此可以按官方产物规范离线复现，免去用户手工点击。
 *
 * 官方规范（见 developers.weixin.qq.com/miniprogram/dev/devtools/npm.html）：
 *   普通 npm 包 → miniprogram_npm/<包名>/index.js（打包后的单文件）
 *   入口默认取 index.js（package.json 的 main 也可指定）
 *
 * 用法：node scripts/build-npm.js
 * 何时需要跑：升级任一 SDK 版本后
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// 需要构建的包：包名 → 入口字段（小程序专用子路径的要显式指定文件）
const PACKAGES = [
  {
    name: '@tencent-ai/workbuddy-cloud-sdk',
    // 必须用官方 miniprogram_dist 产物（自带头部 URL/URLSearchParams polyfill）。
    // 不能用 lib/miniprogram.cjs：它裸用全局 new URL()，而微信小程序运行时
    // 没有 WHATWG URL，初始化会报「endpoint must be an absolute URL」直接崩。
    // （node_modules 的 package.json 是 type:module，官方产物内含
    //   module.exports，小程序按 CJS 语义加载不受影响。）
    entryFile: 'miniprogram_dist/miniprogram.js',
    // 自检标记：官方小程序产物才有的导出，防止误用通用构建
    mustContain: 'ensureMiniProgramPolyfills',
  },
]

function fail(msg) {
  console.error('[build-npm] 失败：' + msg)
  process.exit(1)
}

let anyBuilt = false

PACKAGES.forEach(function (pkg) {
  const srcDir = path.join(ROOT, 'node_modules', pkg.name)
  const srcPkgJsonPath = path.join(srcDir, 'package.json')

  if (!fs.existsSync(srcPkgJsonPath)) {
    // 未安装的包直接跳过（容错：其中一个不用了也不该让构建整体失败）
    console.log('[build-npm] 跳过（未安装）：' + pkg.name)
    return
  }

  const srcPkg = JSON.parse(fs.readFileSync(srcPkgJsonPath, 'utf8'))
  const entryRel = pkg.entryFile || srcPkg.main || 'index.js'
  const srcEntryPath = path.join(srcDir, entryRel)

  if (!fs.existsSync(srcEntryPath)) {
    fail('入口文件不存在：' + srcEntryPath)
  }

  const code = fs.readFileSync(srcEntryPath, 'utf8')

  // 标记自检：确认拿到的确实是目标产物（防止包结构变化后静默复制错文件）
  if (pkg.mustContain && code.indexOf(pkg.mustContain) === -1) {
    fail(
      pkg.name +
        ' 的入口缺少预期标记「' + pkg.mustContain + '」，可能不是小程序专用构建，' +
        '请核对 node_modules/' + pkg.name + ' 的目录结构。'
    )
  }

  // 自检：入口里若还有 require('xxx') 形式的「非相对路径」依赖，
  // 说明它不再自包含，需要改走真正的打包流程（开发者工具「构建 npm」）。
  const externalReqs = []
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(code)) !== null) {
    const dep = m[1]
    if (dep[0] !== '.' && dep[0] !== '/') externalReqs.push(dep)
  }
  if (externalReqs.length) {
    fail(
      pkg.name +
        ' 的入口仍有外部依赖，无法直接复制：' +
        Array.from(new Set(externalReqs)).join(', ') +
        '\n         请改用开发者工具的「工具 → 构建 npm」生成产物。'
    )
  }

  const outDir = path.join(ROOT, 'miniprogram_npm', pkg.name)
  const outEntry = path.join(outDir, 'index.js')

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

  console.log('[build-npm] ✓ ' + pkg.name + ' @ ' + srcPkg.version)
  console.log('    ' + path.relative(ROOT, outEntry).replace(/\\/g, '/') + '  (自包含单文件)')
  anyBuilt = true
})

if (!anyBuilt) fail('没有任何包被构建，请先执行 npm install')
console.log('[build-npm] 全部完成')
