// 云服务连接：全应用唯一来源
//
// 为什么单独成模块：订单（utils/orders.js）与菜品操作日志（utils/dish-logs.js）
// 都走同一套 WorkBuddy 云服务。客户端实例、SDK 的加载路径、诊断包装只要有一处
// 不一样，就会出现「订单连得上、日志连不上」这类极难排查的问题，所以统一收在这里，
// 两边共用同一个实例。
//
// 设计要点：**SDK 懒加载**。require 本模块本身没有任何副作用（不碰 wx、不加载 SDK），
// 因此纯本地模块（如 utils/dishes.js）可以安全地引用日志模块；只有在真的要读写云端时
// 才拉起 SDK，且加载失败只在那一次调用上报错，不影响本地功能。
//
// 历史包袱说明（都已废弃并删除，不要再回头走）：
//   · 云函数方案（wx.cloud.callFunction）—— 云函数环境不注入登录态，
//     以匿名身份访问数据库时能读不能写；
//   · 自建 CloudBase 环境 —— 要求环境绑定当前小程序 AppID，
//     本项目用的环境 WxAppId 为空，绑不上，整体换成了 WorkBuddy 云服务。

// ---------------------------------------------------------------------------
// 云服务初始化参数
//
// 这两个值是「公开发布密钥」和「环境网关地址」，可以放在前端代码里：
//   · publishableKey 只标识「是哪个应用」，本身不带任何权限；
//   · endpoint 是小程序专用固定网关，不能改写成别的域名。
// 真正有权力的密钥全部留在服务端，永远不会下发到小程序。
//
// ⚠️ 这两个值只能来自云服务开通结果，不要手工改写、不要从别处猜。
// ---------------------------------------------------------------------------
const PUBLIC_CONFIG = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_Q7J8UvVewXzjOG0IpQ4004_YvTgzvQz246XbF58PqpMDb7AO7mrwPjs',
}

// 数据库 SDK 的加载。
//
// 优先用相对路径直接指向构建产物（miniprogram_npm/...），这样完全不依赖
// 微信工具的 npm 解析规则 —— 万一「构建 npm」状态异常也不会报
// 「暂不支持 npm 模块」。只有该文件缺失时才回退到按包名加载。
//
// 注意：require 的路径必须是静态字符串，小程序才能做依赖分析。
function loadSDK() {
  try {
    // 小程序专用子路径（含 wx.request / 存储 / polyfill 的完整装配，顺序由 SDK 保证）
    return require('../miniprogram_npm/@tencent-ai/workbuddy-cloud-sdk/index.js')
  } catch (e) {
    // 回退：交给小程序的 npm 解析
    try {
      return require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
    } catch (e2) {
      throw new Error(
        '找不到云服务 SDK。请确认项目里存在 ' +
          'miniprogram_npm/@tencent-ai/workbuddy-cloud-sdk/index.js' +
          '（或在开发者工具执行「工具 → 构建 npm」）。原始错误：' +
          ((e2 && e2.message) || e2)
      )
    }
  }
}

// 诊断包装：把失败的云请求打到手机 vConsole，方便真机排查。
// 它只记录失败摘要（方法/地址/状态码/错误码），不记录请求体、凭据和完整响应。
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

let _cloud = null

// 懒初始化：首次调用时才建立客户端；同一个实例被所有模块复用
function getCloud() {
  if (_cloud) return _cloud

  if (typeof wx === 'undefined' || !wx) {
    throw new Error('当前不在小程序环境里（找不到 wx 对象），云服务无法初始化。')
  }

  try {
    const sdk = loadSDK()
    _cloud = sdk.createMiniProgramWorkBuddyCloud({
      // 两个值都必传：小程序没有 location.origin，SDK 的同源兜底在这里不存在，
      // 漏掉 endpoint 会在初始化阶段直接失败。
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey,
      // 只包这一层，不改全局 wx.request，也不碰 SDK 的请求/鉴权逻辑
      wx: createDiagnosticWx(wx),
    })
  } catch (err) {
    // 初始化失败不缓存，允许下次重试
    _cloud = null
    throw new Error('云服务初始化失败：' + ((err && (err.message || err.errMsg)) || err))
  }

  return _cloud
}

function getDB() {
  return getCloud().database
}

/**
 * 规整 SDK 的响应：它把失败放在 res.error 里而不是抛错，
 * 不转成 throw 的话调用方会拿着 { error } 当数据用（页面显示空白却不报错）。
 *
 * 订单与菜品操作日志共用这一份 —— 两处各写一套，迟早出现「订单报错正常、
 * 日志静默吞掉」这种谁都查不出来的问题。
 */
function unwrap(res) {
  if (res && res.error) {
    const e = res.error
    const msg = (e && (e.message || e.code)) || '数据库操作失败'
    throw new Error(msg)
  }
  return res || {}
}

module.exports = {
  PUBLIC_CONFIG,
  getCloud,
  getDB,
  unwrap,
}
