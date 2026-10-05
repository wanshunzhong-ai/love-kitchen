// 轮询增量视图（清单 C8 · 轮询瘦身）
//
// 为什么需要它：
//   轮询最急时 15 秒跑一轮、开了单就跑一整天。如果每一轮都拉「最近 200 单全字段」，
//   单轮 payload 会随订单积累单调增长 —— 一个月前的订单一个字都没变，却每轮重传一遍，
//   其中还夹着 items / reviews / avoids 三个 jsonb。电话费是用户的，流量也是。
//
// 一轮拆成两步：
//   1) 拉「轻量头」：只取 id / status / updated_at 三个标量，不含任何 jsonb；
//   2) 只对「新出现的 / 变了的」那几条拉全字段，合并进本地缓存。
//
//   平稳使用下第 2 步通常是 0 条。单轮 payload 于是只与「订单条数」有关（且被取单上限封顶），
//   与「每条订单多大」「用了多久」都无关 —— 这正是验收要的「不随时间线性增长」。
//
// 为什么 `updated_at` 靠得住：
//   utils/orders.js 的**每一条**写路径都会带上 updated_at（改内容 / 推进状态 / 驳回 / 评价），
//   insert 走列的 DEFAULT now()，删除靠「头里消失」发现。所以「updated_at 变了」≡「这条动过了」。
//   唯二漏网的情形都有兜底：同一毫秒内两次写入（status 也一起比对），
//   以及轻量查询万一没带回这一列（见 headsUsable）。
//
// 本文件不碰 wx、不 require 云 SDK —— 取数函数由调用方注入（live.js 注入三个 api action），
// 所以纯 node 就能跑行为测试。

const { STATUS } = require('./constants')

/** 订单对象 → 可比对的轻量键（形状与 listOrderHeads 返回的头一致） */
function keyOf(order) {
  if (!order) return null
  const id = orderId(order)
  if (!id) return null
  return {
    id: id,
    status: order.status || STATUS.pending,
    updated_at: Number(order.updated_at) || 0,
  }
}

/** 从订单对象取 id（兼容 _id / id） */
function orderId(order) {
  if (!order) return ''
  const v = order._id !== undefined && order._id !== null && order._id !== ''
    ? order._id
    : order.id
  return v === undefined || v === null || v === '' ? '' : String(v)
}

/** id 按数值排 —— 保证「要拉哪几条」的顺序可预期 */
function byNum(a, b) {
  return Number(a) - Number(b)
}

/**
 * 头列表 → { id: 轻量键 } 映射。脏输入一律跳过。
 * @param {Array} heads
 */
function headMap(heads) {
  const map = {}
  ;(Array.isArray(heads) ? heads : []).forEach(function (h) {
    const k = keyOf(h)
    if (k) map[k.id] = k
  })
  return map
}

/**
 * 「轻量头这一列到底带回来了没有」。
 *
 * 万一网关把 select 的列裁剪掉、或者列的默认值没落上，updated_at 会全是 0 ——
 * 那时增量会永远认为「没变化」，页面**静默失去实时性**（最难查的一类故障：
 * 不报错、只是不再更新）。所以一个有效的头都没有就直接判定「轻量头不可用」，
 * 调用方退回全量拉取 —— 慢一点，但一定对。
 * @param {Array} heads
 */
function headsUsable(heads) {
  const list = Array.isArray(heads) ? heads : []
  if (!list.length) return true // 没单也是「可用」，不必退回全量
  return list.some(function (h) {
    return Number(h && h.updated_at) > 0
  })
}

/**
 * 哪些 id 需要（重新）拉全字段。
 * @param {object} prev 上一轮的头映射（{} = 首轮，但首轮走全量、不经过这里）
 * @param {object} next 这一轮的头映射
 * @returns {string[]} 按数值升序
 */
function staleIds(prev, next) {
  const p = prev && typeof prev === 'object' ? prev : {}
  const n = next && typeof next === 'object' ? next : {}
  const out = []
  Object.keys(n).forEach(function (id) {
    const old = p[id]
    const cur = n[id]
    if (!old) {
      out.push(id) // 新出现的单
      return
    }
    // 没有可靠时间戳（列没带回来 / 值为 0）→ 每轮都重取。正确优先于省流量：
    // 万一只有部分行缺时间戳，至少那几行不会静默卡在旧状态。
    if (!cur.updated_at) {
      out.push(id)
      return
    }
    if (old.status !== cur.status || old.updated_at !== cur.updated_at) out.push(id)
  })
  return out.sort(byNum)
}

/**
 * 按头顺序取出完整订单（窗口内、且已经缓存到的）。
 * 顺序 = 头的顺序 = `created_at DESC`，与改造前 listOrders 的顺序完全一致。
 * @param {object} cache { id: order }
 * @param {Array} ids 头的 id 列表（保持原序）
 */
function assemble(cache, ids) {
  const c = cache && typeof cache === 'object' ? cache : {}
  const out = []
  ;(Array.isArray(ids) ? ids : []).forEach(function (id) {
    const o = c[String(id)]
    if (o) out.push(o)
  })
  return out
}

/**
 * 丢掉滑出取单窗口的缓存（否则缓存会随使用时间无限长大）。
 * @returns {number} 被丢掉几条
 */
function prune(cache, ids) {
  const c = cache && typeof cache === 'object' ? cache : {}
  const keep = {}
  ;(Array.isArray(ids) ? ids : []).forEach(function (id) {
    keep[String(id)] = true
  })
  let dropped = 0
  Object.keys(c).forEach(function (id) {
    if (!keep[id]) {
      delete c[id]
      dropped += 1
    }
  })
  return dropped
}

/**
 * 造一个增量视图。
 *
 * 注入三个取数函数（都可换成桩，方便测试）：
 *   fetchHeads()     → Promise<{heads}>       轻量头，每轮都调
 *   fetchByIds(ids)  → Promise<{orders}>      只为「新的/变了的」调，通常 0 条
 *   fetchAll()       → Promise<{orders}>      首轮（或轻量头不可用时的兜底）调一次
 *
 * load() 的返回值与 utils/orders.js 的 listOrders 同形状（{ orders }），
 * 因此 live.js 的 watcher 与页面层一行都不用改。
 */
function createSync(io) {
  const opt = io || {}
  const fetchHeads = opt.fetchHeads
  const fetchByIds = opt.fetchByIds
  const fetchAll = opt.fetchAll

  const st = {
    cache: {},   // id → 完整订单
    prev: {},    // id → 轻量键（上一轮）
    primed: false,
    fulls: 0,    // 全量拉取次数（诊断用）
    slims: 0,    // 轻量头拉取次数
    details: 0,  // 详情拉取次数（= 「变了的那几条」的批次数）
  }

  /**
   * 首轮 / 兜底：一次性拉全量重建缓存。
   * 失败照样往上抛 —— 由 watcher 的退避机制接管，这里不留半份缓存。
   */
  async function loadFull(heads) {
    const res = await fetchAll()
    const orders = (res && res.orders) || []
    st.cache = {}
    const prev = {}
    orders.forEach(function (o) {
      const k = keyOf(o)
      if (!k) return
      st.cache[k.id] = o
      prev[k.id] = k
    })
    st.prev = prev
    st.primed = true
    st.fulls += 1
    const ids = Array.isArray(heads) && heads.length
      ? heads.map(function (h) { return String(h && h.id) })
      : Object.keys(prev)
    prune(st.cache, ids)
    return { orders: assemble(st.cache, ids) }
  }

  async function load() {
    const headsRes = await fetchHeads()
    const heads = (headsRes && headsRes.heads) || []
    st.slims += 1
    const ids = heads.map(function (h) { return String(h && h.id) }).filter(Boolean)

    // 首轮，或轻量头不可用 → 退回全量（正确优先）
    if (!st.primed || !headsUsable(heads)) return loadFull(heads)

    const next = headMap(heads)
    const need = staleIds(st.prev, next)

    if (need.length) {
      const res = await fetchByIds(need)
      const rows = (res && res.orders) || []
      const got = {}
      rows.forEach(function (o) {
        const k = keyOf(o)
        if (!k) return
        st.cache[k.id] = o
        got[k.id] = true
      })
      // **只把确实拿到的 id 记进 prev**：某条详情这次没回来（行级权限 / 恰好被删）
      // 就不记，下一轮它还会被当成「要拉的」，直到真拿到为止。
      // 若整批请求失败，fetchByIds 会抛错、根本走不到这里 —— prev 保持原样，下轮重试。
      need.forEach(function (id) {
        if (got[id]) st.prev[id] = next[id]
      })
      st.details += 1
    }

    // 滑出窗口的 id 从 prev 里清掉，避免 prev 无限长大
    Object.keys(st.prev).forEach(function (id) {
      if (!next[id]) delete st.prev[id]
    })
    prune(st.cache, ids)

    return { orders: assemble(st.cache, ids) }
  }

  return {
    load: load,
    /** 丢掉全部状态（身份切换 / 需要强制重建时用） */
    reset() {
      st.cache = {}
      st.prev = {}
      st.primed = false
    },
    /** 诊断：看到底省了多少 */
    stats() {
      return {
        primed: st.primed,
        cached: Object.keys(st.cache).length,
        fulls: st.fulls,
        slims: st.slims,
        details: st.details,
      }
    },
  }
}

module.exports = {
  keyOf,
  orderId,
  headMap,
  headsUsable,
  staleIds,
  assemble,
  prune,
  createSync,
}
