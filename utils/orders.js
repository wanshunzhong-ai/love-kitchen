// 订单数据服务：CloudBase PostgreSQL（小程序直连 + RLS 授权）
//
// 为什么不用云函数：
//   云函数写入数据库需要「管理员密钥」，而本项目没有配置 API Key；
//   小程序端反而天然带着微信身份 JWT，配好 RLS 策略后即可安全读写。
//
// 权限模型（已在数据库侧配好，见 cloudbase/migrations/20260928150000_orders_rls.sql）：
//   表级 GRANT + 行级 RLS 策略，允许 authenticated（已登录的微信用户）读写订单表。
//   订单是「两个人共享同一份」的语义，因此策略不按人隔离 —— 谁能登录谁就能看全部。
//
// 字段与小程序端历史的 NoSQL 版本保持一致（_id / created_at 为毫秒数），
// 这样 pages/ 下所有页面零改动。

// 数据库 SDK 的加载。
//
// 优先用相对路径直接指向构建产物（miniprogram_npm/...)，这样完全不依赖
// 微信工具的 npm 解析规则 —— 万一「构建 npm」状态异常也不会报
// 「暂不支持 npm 模块」。只有该文件缺失时才回退到按包名加载。
//
// 注意：require 的路径必须是静态字符串，小程序才能做依赖分析。
function loadSDK() {
  try {
    return require('../miniprogram_npm/@cloudbase/wx-cloud-client-sdk/index.js')
  } catch (e) {
    // 回退：交给小程序的 npm 解析
    try {
      return require('@cloudbase/wx-cloud-client-sdk')
    } catch (e2) {
      throw new Error(
        '找不到数据库 SDK。请确认项目里存在 miniprogram_npm/@cloudbase/wx-cloud-client-sdk/index.js' +
          '（或在开发者工具执行「工具 → 构建 npm」）。原始错误：' +
          ((e2 && e2.message) || e2)
      )
    }
  }
}

const { init } = loadSDK()

const ENV_ID = 'zws-04161130-l-d6gd7g8f0c8c7fb17'
const TABLE = 'orders'

// 允许的订单状态（与 utils/constants.js 保持一致）
const ORDER_STATUSES = ['pending', 'cooking', 'done']

// 单次最多拉多少条订单。订单页是一次性拉全再本地筛选，
// 200 条足够很长一段时间的日常使用，超出后只显示最近的。
const MAX_ORDERS = 200

let _db = null

// 懒初始化：首次调用时才建立连接
function getDB() {
  if (_db) return _db
  if (!wx.cloud) {
    throw new Error('当前微信基础库版本过低（需 2.2.3+），无法使用订单功能')
  }
  _db = init(wx.cloud).rdb()
  return _db
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
function unwrap(res) {
  if (res && res.error) {
    const e = res.error
    throw new Error((e && (e.message || e.code)) || '数据库操作失败')
  }
  return res || {}
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
  return { id: inserted ? String(inserted.id) : '' }
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

  const res = unwrap(await getDB().from(TABLE).update(patch).eq('id', id).select())
  const rows = Array.isArray(res.data) ? res.data : []
  return { updated: rows.length }
}

async function updateOrderStatus(event) {
  const id = event && event.id
  const status = event && event.status
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')
  if (ORDER_STATUSES.indexOf(status) < 0) throw new Error('订单状态不合法')

  const res = unwrap(
    await getDB()
      .from(TABLE)
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
  )
  const rows = Array.isArray(res.data) ? res.data : []
  return { updated: rows.length }
}

async function deleteOrder(event) {
  const id = event && event.id
  if (id === undefined || id === null || id === '') throw new Error('缺少订单 id')

  const res = unwrap(await getDB().from(TABLE).delete().eq('id', id).select())
  const rows = Array.isArray(res.data) ? res.data : []
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

module.exports = { handle, ACTIONS, ENV_ID, TABLE }
