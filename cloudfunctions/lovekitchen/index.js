// 爱心小厨房 · 云函数（单函数 + action 路由）
// 说明：小程序端只调用 wx.cloud.callFunction，走微信内部通道，
//       不需要配置任何 request 合法域名；所有数据库读写都在服务端完成，
//       因此 dishes / orders 两个集合的安全规则可以设为「所有人不可读写」，
//       既避开前端权限问题，又保证两人共享同一份数据。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const DISHES = 'dishes'
const ORDERS = 'orders'

// 云开发单次 get 上限 100 条（服务端），菜品有 100+ 道，必须分页循环拉全
const PAGE_SIZE = 100

/**
 * 分批拉取集合全部文档
 * @param {string} coll 集合名
 * @param {object} [options] orderBy { field, direction }
 */
async function fetchAll(coll, options) {
  const opts = options || {}
  const out = []
  let skip = 0

  for (;;) {
    let query = db.collection(coll)
    if (opts.orderBy && opts.orderBy.field) {
      query = query.orderBy(opts.orderBy.field, opts.orderBy.direction || 'asc')
    }
    const res = await query.skip(skip).limit(PAGE_SIZE).get()
    const batch = res.data || []
    out.push.apply(out, batch)
    if (batch.length < PAGE_SIZE) break
    skip += PAGE_SIZE
    // 兜底：避免异常情况下死循环
    if (skip > 10000) break
  }

  return out
}

// ---------- dishes ----------

async function listDishes() {
  const list = await fetchAll(DISHES, {
    orderBy: { field: 'created_at', direction: 'asc' },
  })
  return { dishes: list }
}

async function getDish(event) {
  const id = event.id
  if (!id) throw new Error('缺少菜品 id')
  const res = await db.collection(DISHES).doc(String(id)).get()
  return { dish: res.data || null }
}

async function saveDish(event) {
  const payload = event.payload || {}
  if (!payload.name) throw new Error('菜品名称不能为空')

  // 只写入明确传了的字段，避免部分更新时把其它字段冲成默认值
  const doc = {
    name: payload.name,
    category: payload.category || '经典热菜',
    emoji: payload.emoji || '🍴',
    spice: payload.spice || '不辣',
    description: payload.description || '',
  }

  if (event.id) {
    const patch = {}
    Object.keys(doc).forEach(function (k) {
      if (payload[k] !== undefined) patch[k] = doc[k]
    })
    patch.updated_at = Date.now()
    await db.collection(DISHES).doc(String(event.id)).update({ data: patch })
    return { id: String(event.id), created: false }
  }

  doc.created_at = Date.now()
  const res = await db.collection(DISHES).add({ data: doc })
  return { id: res._id, created: true }
}

async function deleteDish(event) {
  const id = event.id
  if (!id) throw new Error('缺少菜品 id')
  const res = await db.collection(DISHES).doc(String(id)).remove()
  return { removed: (res.stats && res.stats.removed) || 0 }
}

// ---------- orders ----------

async function listOrders() {
  const list = await fetchAll(ORDERS, {
    orderBy: { field: 'created_at', direction: 'desc' },
  })
  return { orders: list }
}

async function createOrder(event) {
  const payload = event.payload || {}
  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) throw new Error('订单里没有菜品')

  const doc = {
    items: items.map(function (it) {
      return {
        dishId: it.dishId,
        name: it.name,
        emoji: it.emoji,
        spice: it.spice || '不辣',
        qty: Number(it.qty) || 1,
      }
    }),
    remark: payload.remark || '',
    order_by: payload.order_by || '宝贝',
    status: 'pending',
    created_at: Date.now(),
    updated_at: Date.now(),
  }

  const res = await db.collection(ORDERS).add({ data: doc })
  return { id: res._id }
}

async function updateOrderStatus(event) {
  const id = event.id
  const status = event.status
  if (!id) throw new Error('缺少订单 id')
  if (['pending', 'cooking', 'done'].indexOf(status) < 0) {
    throw new Error('订单状态不合法')
  }
  const res = await db.collection(ORDERS).doc(String(id)).update({
    data: { status: status, updated_at: Date.now() },
  })
  return { updated: (res.stats && res.stats.updated) || 0 }
}

async function deleteOrder(event) {
  const id = event.id
  if (!id) throw new Error('缺少订单 id')
  const res = await db.collection(ORDERS).doc(String(id)).remove()
  return { removed: (res.stats && res.stats.removed) || 0 }
}

// ---------- 统计（调试用，顺便验证连通性） ----------

async function stats() {
  const [d, o] = await Promise.all([
    db.collection(DISHES).count(),
    db.collection(ORDERS).count(),
  ])
  return {
    dishes: d.total,
    orders: o.total,
  }
}

const ACTIONS = {
  listDishes: listDishes,
  getDish: getDish,
  saveDish: saveDish,
  deleteDish: deleteDish,
  listOrders: listOrders,
  createOrder: createOrder,
  updateOrderStatus: updateOrderStatus,
  deleteOrder: deleteOrder,
  stats: stats,
}

exports.main = async (event, context) => {
  const action = (event && event.action) || ''
  const handler = ACTIONS[action]

  if (!handler) {
    return { ok: false, error: '未知的 action: ' + action }
  }

  try {
    const data = await handler(event || {}, context)
    return Object.assign({ ok: true }, data)
  } catch (err) {
    console.error('[lovekitchen] action=' + action + ' 失败:', err)
    return {
      ok: false,
      error: (err && err.message) || '服务端出错了',
    }
  }
}
