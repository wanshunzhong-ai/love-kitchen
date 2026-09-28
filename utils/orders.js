// 订单数据服务：WorkBuddy 云服务 · PostgreSQL（小程序直连）
//
// 为什么是这一套：
//   云开发自建环境要求「环境必须绑定当前小程序 AppID」，本项目用的是
//   平台代建的腾讯云账号环境，WxAppId 为空，绑定不上，所以整体换成
//   WorkBuddy 云服务 —— 它自带网关和授权，小程序端不需要任何密钥。
//
// 身份与权限：
//   小程序端没有 Origin，SDK 用 publishableKey + 微信 Referer 走环境网关；
//   行级权限（RLS）在数据库侧配置，订单表当前是「两人共享一份」的语义，
//   策略放开，因此谁能进小程序谁就能看全部订单 —— 这正是情侣点菜想要的效果。
//
// 字段与页面层的约定和历史上完全一致（id / items / created_at 毫秒数），
// 所以 pages/ 下所有页面零改动。

const TABLE = 'orders'

// 允许的订单状态（与 utils/constants.js 保持一致）
const ORDER_STATUSES = ['pending', 'cooking', 'done']

// 单次最多拉多少条订单。订单页是一次性拉全再本地筛选，
// 200 条足够很长一段时间的日常使用，超出后只显示最近的。
const MAX_ORDERS = 200

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

const { createMiniProgramWorkBuddyCloud } = loadSDK()

let _cloud = null

// 懒初始化：首次调用时才建立客户端；同一个实例被所有 action 复用
function getCloud() {
  if (_cloud) return _cloud

  if (typeof wx === 'undefined' || !wx) {
    throw new Error('当前不在小程序环境里（找不到 wx 对象），云服务无法初始化。')
  }

  try {
    _cloud = createMiniProgramWorkBuddyCloud({
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

// PG 的 timestamptz 取回来是 ISO 字符串，而页面层 formatTime 期望毫秒数
function toMillis(v) {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return isNaN(t) ? 0 : t
}

// items 用 jsonb 存，SDK 会自动解析成数组；这里做一层兜底
function parseItems(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }
  return []
}

// 数据库行 → 页面层期望的结构
function rowToOrder(row) {
  const id = String(row.id)
  return {
    _id: id,
    id: id,
    items: parseItems(row.items),
    remark: row.remark || '',
    order_by: row.order_by || '宝贝',
    status: row.status || 'pending',
    created_at: toMillis(row.created_at),
    updated_at: toMillis(row.updated_at),
  }
}

// 页面层传来的菜品清单 → 只保留该存的字段，避免脏数据进库
function normalizeItems(raw) {
  const items = Array.isArray(raw) ? raw : []
  return items.map(function (it) {
    return {
      dishId: it.dishId,
      name: it.name,
      emoji: it.emoji,
      spice: it.spice || '不辣',
      qty: Number(it.qty) || 1,
    }
  })
}

// 统一处理 SDK 返回：出错就抛，交给调用方 catch
//
// 除了 SDK 自己报的 error，这里还识别一类「静默失败」：
// 写操作（更新/删除）被 RLS 拦截时，SDK 返回的 data 是空数组而不是错误，
// 如果不额外判断，页面会误以为成功了 —— 所以写操作另用 requireAffected 校验。
function unwrap(res) {
  if (res && res.error) {
    const e = res.error
    const msg = (e && (e.message || e.code)) || '数据库操作失败'
    throw new Error(msg)
  }
  return res || {}
}

// 写操作用：确认真的影响了行数，空数组说明没改到（多半是权限或记录不存在）
function affectedRows(res) {
  const out = unwrap(res)
  return Array.isArray(out.data) ? out.data : []
}

async function listOrders() {
  const res = unwrap(
    await getDB()
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, MAX_ORDERS - 1)
  )
  const rows = Array.isArray(res.data) ? res.data : []
  return { orders: rows.map(rowToOrder) }
}

async function getOrder(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const res = unwrap(await getDB().from(TABLE).select('*').eq('id', id).limit(1))
  const rows = Array.isArray(res.data) ? res.data : []
  return { order: rows.length ? rowToOrder(rows[0]) : null }
}

async function createOrder(event) {
  const payload = (event && event.payload) || {}
  const items = normalizeItems(payload.items)
  if (!items.length) throw new Error('订单里没有菜品')

  const row = {
    items: items,
    remark: payload.remark || '',
    order_by: payload.order_by || '宝贝',
    status: 'pending',
  }

  const res = unwrap(await getDB().from(TABLE).insert(row).select())
  const inserted = Array.isArray(res.data) && res.data.length ? res.data[0] : null
  if (!inserted) throw new Error('订单没能写入，请稍后再试')
  return { id: String(inserted.id) }
}

// 编辑订单：菜品清单全量替换（页面每次提交完整清单）
async function updateOrder(event) {
  const id = event && event.id
  const payload = (event && event.payload) || {}
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const items = normalizeItems(payload.items)
  if (!items.length) throw new Error('订单里没有菜品')

  const patch = {
    items: items,
    remark: payload.remark || '',
    order_by: payload.order_by || '宝贝',
    updated_at: new Date().toISOString(),
  }

  if (payload.status !== undefined) {
    if (ORDER_STATUSES.indexOf(payload.status) < 0) throw new Error('订单状态不合法')
    patch.status = payload.status
  }

  const rows = affectedRows(await getDB().from(TABLE).update(patch).eq('id', id).select())
  if (!rows.length) throw new Error('这一单没能保存，可能已经被删掉了')
  return { updated: rows.length }
}

async function updateOrderStatus(event) {
  const id = event && event.id
  const status = event && event.status
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')
  if (ORDER_STATUSES.indexOf(status) < 0) throw new Error('订单状态不合法')

  const rows = affectedRows(
    await getDB()
      .from(TABLE)
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
  )
  if (!rows.length) throw new Error('这一单没能更新，可能已经被删掉了')
  return { updated: rows.length }
}

async function deleteOrder(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const rows = affectedRows(await getDB().from(TABLE).delete().eq('id', id).select())
  if (!rows.length) throw new Error('这一单没能删除，可能已经被删掉了')
  return { removed: rows.length }
}

async function stats() {
  const res = unwrap(await getDB().from(TABLE).select('*', { count: 'exact', head: true }))
  return { orders: typeof res.count === 'number' ? res.count : 0 }
}

// action 路由表：与 utils/api.js 的 ORDER_ACTIONS 对应
const ACTIONS = {
  listOrders: listOrders,
  getOrder: getOrder,
  createOrder: createOrder,
  updateOrder: updateOrder,
  updateOrderStatus: updateOrderStatus,
  deleteOrder: deleteOrder,
  stats: stats,
}

async function handle(action, payload) {
  const fn = ACTIONS[action]
  if (!fn) throw new Error('未知的订单 action: ' + action)
  return fn(payload || {})
}

module.exports = { handle, ACTIONS, PUBLIC_CONFIG, TABLE }
