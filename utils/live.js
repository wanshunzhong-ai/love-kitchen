// 实时感知点单情况（掌勺人第一时间知道来了单 / 干饭人第一时间知道开做了）
//
// 为什么是「智慧轮询」而不是真推送：
//   云服务 SDK（@tencent-ai/workbuddy-cloud-sdk）只提供 database / auth / storage / llm
//   四个模块，没有 realtime 订阅、也没有长连接（已核对 index.js 全量导出）。
//   小程序端拿不到 websocket 通道，因此「实时」只能靠前台轮询来逼近。
//   既然只能轮询，重点就落在「轮得聪明」上 —— 见下面三条。
//
// 轮询的三条设计：
//   1) 按「有没有急事」变频：有待开做的单 15s，有单在做 30s，全上完菜 60s。
//      没单的时候没必要勤问，有单的时候必须快 —— 请求量跟着注意力走。
//   2) 失败退避：出错就 15s → 30s → 60s → 120s 翻倍，成功后立刻回到正常节奏。
//      断网时不能死循环猛敲接口（真机上是耗电大户）。
//   3) 只在前台轮：页面 onShow 启动、onHide 停。小程序切后台后 setTimeout 会被
//      冻结或限流，与其留个僵尸定时器，不如明确停掉，回前台立刻补一次。
//
// 变化检测用「快照 + 差异」：
//   每次拉到的订单列表压成 { id: { status, dishes, qty, reviews, dine } }，
//   和上一份比。第一次只建基线（不把已有订单全报成「新增」），
//   之后才能算出「新来几单 / 哪单改状态了 / 哪道菜被评价了」。
//
// 本文件的纯函数部分不碰 wx，可被 node 直接跑契约测试；
// 只有 createWatcher 会用到计时器。
const review = require('./review')
const rejectLib = require('./reject')

// 轮询节奏（毫秒）。数字调大更省电，调小更灵敏，这三档是「手感」和「耗电」的折中。
const INTERVALS = {
  urgent: 15000, // 有单等着开做 / 有菜正在做
  warm: 30000, // 有事但不急（比如还有单没上菜，但没在做的）
  idle: 60000, // 全都上完菜了，慢慢看
  max: 120000, // 连续失败时的退避上限
}

/**
 * 订单列表 → 可比较的快照。
 * 只留「变了才值得提示」的字段，避免把整个对象序列化（items 里还有备注等长文本）。
 * @param {Array} orders
 * @returns {Object<string, {status:string, dishes:number, qty:number, reviews:number, dine:string}>}
 */
function snapshot(orders) {
  const map = {}
  const list = Array.isArray(orders) ? orders : []
  list.forEach(function (o) {
    if (!o) return
    const id = String(o._id || o.id || '')
    if (!id) return
    const items = Array.isArray(o.items) ? o.items : []
    let qty = 0
    items.forEach(function (it) {
      qty += Number(it && it.qty) || 1
    })
    map[id] = {
      status: o.status || 'pending',
      dishes: items.length,
      qty: qty,
      // 只关心「评价条数有没有变多」，具体内容由页面自己拉
      reviews: Object.keys(review.normalizeReviews(o.reviews)).length,
      dine: String(o.dine_date || '') + '|' + String(o.dine_slot || ''),
    }
  })
  return map
}

/**
 * 两份快照的差异。
 *
 * 关键：prior 为 null 时表示「还没建立基线」，此时**不报任何变化** ——
 * 否则第一次加载会把全部历史订单都算成「刚来的新单」，一进页面就炸出一堆提示。
 *
 * @param {object|null} prior 上一份快照（null = 首轮）
 * @param {object} next 这一份快照
 * @returns {{primed:boolean, added:Array, statusChanged:Array, reviewsAdded:Array, any:boolean}}
 */
function diff(prior, next) {
  const p = prior && typeof prior === 'object' ? prior : null
  const n = next && typeof next === 'object' ? next : {}
  const added = []
  const statusChanged = []
  const reviewsAdded = []
  const primed = !!p

  Object.keys(n).forEach(function (id) {
    const cur = n[id]
    const old = p ? p[id] : null
    if (!old) {
      if (primed) added.push(id)
      return
    }
    if (old.status !== cur.status) statusChanged.push({ id: id, from: old.status, to: cur.status })
    if (cur.reviews > old.reviews) reviewsAdded.push(id)
  })

  // 顺序稳定：Object.keys 在数字键上是有序的，但 id 是字符串数字，
  // 这里按数值排一下，保证快照与差异顺序可预期（测试也更好写）
  const byNum = function (a, b) {
    return Number(a) - Number(b)
  }
  added.sort(byNum)
  reviewsAdded.sort(byNum)

  return {
    primed: primed,
    added: added,
    statusChanged: statusChanged,
    reviewsAdded: reviewsAdded,
    any: !!(added.length || statusChanged.length || reviewsAdded.length),
  }
}

/**
 * 当前「有多急」——决定下一次隔多久轮询，以及底栏角标显示几。
 * 掌勺人的急事是「有单等着开做」，干饭人的急事是「有菜正在做 / 单被驳回了」。
 * 注意 rejected 是单独一档：被驳回的单球已经回到干饭人那边，不算掌勺人的待做。
 * @param {Array} orders
 * @param {string} role 'cook' | 'orderer'
 */
function urgency(orders, role) {
  const list = Array.isArray(orders) ? orders : []
  let pending = 0
  let cooking = 0
  let done = 0
  let rejected = 0
  list.forEach(function (o) {
    const s = (o && o.status) || 'pending'
    if (s === 'done') done += 1
    else if (s === 'cooking') cooking += 1
    else if (s === 'rejected') rejected += 1
    else pending += 1
  })
  // 「手上有活」= 有待开做 / 正在做；已驳回的不算（那是等 TA 改单的）
  const active = pending + cooking > 0

  if (role === 'cook') {
    return {
      pending: pending,
      cooking: cooking,
      done: done,
      rejected: rejected,
      active: active,
      // 角标 = 有几单等着开做（「该我动手了」的量）
      badge: pending,
      badgeTab: 'todo',
      urgent: pending > 0,
      warm: active && pending === 0,
    }
  }

  // 干饭人关心的两件事：菜在锅里 + 单被退回来了（后者要动手指改单）
  const mine = cooking + rejected
  return {
    pending: pending,
    cooking: cooking,
    done: done,
    rejected: rejected,
    active: active,
    // 角标 = 有几单正在做 + 有几单被驳回
    badge: mine,
    badgeTab: 'orders',
    urgent: mine > 0,
    warm: active && mine === 0,
  }
}

/**
 * 下一次轮询的间隔。
 * 有失败就退避（指数增长、封顶），没失败就按紧急度取三档之一。
 * @param {object} info urgency() 的结果
 * @param {number} failCount 已经连续失败几次
 */
function nextInterval(info, failCount) {
  const fails = Math.max(0, Number(failCount) || 0)
  if (fails > 0) {
    const backoff = INTERVALS.urgent * Math.pow(2, fails)
    return Math.min(backoff, INTERVALS.max)
  }
  const i = info || {}
  if (i.urgent) return INTERVALS.urgent
  if (i.warm) return INTERVALS.warm
  return INTERVALS.idle
}

// 从订单列表里按 id 找一条
function findOrder(orders, id) {
  const list = Array.isArray(orders) ? orders : []
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (o && String(o._id || o.id) === String(id)) return o
  }
  return null
}

function dishCountOf(order) {
  const items = (order && Array.isArray(order.items) && order.items) || []
  let n = 0
  items.forEach(function (it) {
    n += Number(it && it.qty) || 1
  })
  return n
}

/**
 * 把差异翻译成「一句话提示」。返回 null 表示这一次变化不值得打扰用户。
 *
 * 不提示的情况都是有意的：
 *   · 掌勺人自己推进的状态变化 —— 他刚点的按钮，再提示一遍是噪音；
 *   · 干饭人自己下的新单 —— 同上（他刚点完单，跳的就是订单页）。
 * @param {object} d diff() 的结果
 * @param {Array} orders 最新的订单列表
 * @param {string} role 'cook' | 'orderer'
 * @returns {{key:string, emoji:string, text:string, path:string}|null}
 */
function notice(d, orders, role) {
  if (!d || !d.primed || !d.any) return null

  if (role === 'cook') {
    if (d.added.length) {
      let dishes = 0
      d.added.forEach(function (id) {
        dishes += dishCountOf(findOrder(orders, id))
      })
      return {
        key: 'added',
        emoji: '🍚',
        text: d.added.length > 1
          ? '来了 ' + d.added.length + ' 个新订单，共 ' + dishes + ' 道菜'
          : '来了新订单，共 ' + dishes + ' 道菜',
        path: '/pages/todo/todo',
      }
    }
    // 被自己驳回的单，TA 改好又交回来了（已驳回 → 待开做）
    const back = d.statusChanged.filter(function (c) {
      return c.from === 'rejected' && c.to === 'pending'
    })
    if (back.length) {
      return {
        key: 'resubmitted',
        emoji: '🔄',
        text: back.length > 1 ? 'TA 改好重新提交了 ' + back.length + ' 单' : 'TA 改好重新提交啦，再看看',
        path: '/pages/todo/todo',
      }
    }
    if (d.reviewsAdded.length) {
      return {
        key: 'reviewed',
        emoji: '⭐',
        text: d.reviewsAdded.length > 1
          ? 'TA 给 ' + d.reviewsAdded.length + ' 单的菜打了分，去看看'
          : 'TA 给菜打分啦，去看看',
        path: '/pages/orders/orders',
      }
    }
    return null
  }

  // 干饭人：只关心掌勺人的动作。
  // 驳回排在最前 —— 这是要 TA 动手的事（改菜重新提交，或者干脆删掉），
  // 而且顺手把理由带出来，省得再点进去找。
  const backChange = d.statusChanged.filter(function (c) {
    return c.to === 'rejected'
  })[0]
  if (backChange) {
    const why = rejectLib.shortReason((findOrder(orders, backChange.id) || {}).reject_reason, 10)
    return {
      key: 'rejected',
      emoji: '🙅',
      text: why ? '这一单被退回啦：' + why : '有一单被退回来啦，去看看',
      path: '/pages/orders/orders',
    }
  }

  let toCooking = 0
  let toDone = 0
  d.statusChanged.forEach(function (c) {
    if (c.to === 'cooking') toCooking += 1
    if (c.to === 'done') toDone += 1
  })
  if (toDone > 0) {
    return {
      key: 'done',
      emoji: '🎉',
      text: toDone > 1 ? toDone + ' 单都上菜啦，开饭！' : '上菜啦，快去端走 🎉',
      path: '/pages/orders/orders',
    }
  }
  if (toCooking > 0) {
    return {
      key: 'cooking',
      emoji: '🧑‍🍳',
      text: '掌勺人已经开火啦，稍等一会儿',
      path: '/pages/orders/orders',
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 底栏角标：watcher 每轮把最新数据记在这里，custom-tab-bar 读它
// （tabBar 是独立 Component，但和小程序主包共用同一个 JS 上下文，
//   所以直接共享模块级变量最省事，不必绕 storage）
// ---------------------------------------------------------------------------
let lastUrgency = null

/**
 * 取某个身份下、各 tab 的角标文案。
 * @param {string} role
 * @returns {Object<string, string>} 例：{ todo: '3' }
 */
function badgeFor(role) {
  if (!lastUrgency || !lastUrgency.badgeTab || lastUrgency.badge <= 0) return {}
  // 角标跟的是「当前身份关心的那个 tab」；身份对不上就不显示，避免串台
  const expectTab = role === 'cook' ? 'todo' : 'orders'
  if (lastUrgency.badgeTab !== expectTab) return {}
  const out = {}
  out[lastUrgency.badgeTab] = lastUrgency.badge > 99 ? '99+' : String(lastUrgency.badge)
  return out
}

/** 最近一轮的紧急度（没轮过返回 null） */
function lastInfo() {
  return lastUrgency
}

// ---------------------------------------------------------------------------
// 页面订阅
//
// 为什么需要这层：轮询器是 App 级的唯一实例（这样底栏角标在任何 tab 页都准），
// 但「把新数据画到列表上」「浮一句提示」是页面自己的事。
// 于是用一个极简的发布订阅：watcher 每轮 emit 一次，页面按需订阅。
// ---------------------------------------------------------------------------
const listeners = []

/**
 * 订阅每一轮的结果。
 * @param {function(object, Array, Error)} fn (diff, orders, err) => void
 *        成功时 err 为空；失败时 diff / orders 为空、err 有值。
 *        页面靠这个把「一次都没拉到」和「中途偶发失败」区分开：
 *        前者进错误态给用户一个重试按钮，后者静默等下一轮。
 * @returns {function} 退订函数（页面 onHide 调它）
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return function () {}
  if (listeners.indexOf(fn) < 0) listeners.push(fn)
  return function () {
    unsubscribe(fn)
  }
}

function unsubscribe(fn) {
  const i = listeners.indexOf(fn)
  if (i >= 0) listeners.splice(i, 1)
}

function emit(d, orders, err) {
  // 复制一份再遍历：回调里可能会退订自己，直接遍历原数组会漏掉后面的订阅者
  listeners.slice().forEach(function (fn) {
    try {
      fn(d, orders, err)
    } catch (e) {
      console.error('[live] 订阅回调出错', e)
    }
  })
}

/**
 * 让当前页面的自定义 tabBar 重算角标。
 * 用 getCurrentPages 拿栈顶页面 —— 只有栈顶那个 tabBar 是可见的。
 */
function notifyTabBar() {
  if (typeof getCurrentPages !== 'function') return
  const pages = getCurrentPages()
  const top = pages && pages.length ? pages[pages.length - 1] : null
  if (!top || typeof top.getTabBar !== 'function') return
  const bar = top.getTabBar()
  if (bar && typeof bar.refresh === 'function') bar.refresh()
}

// ---------------------------------------------------------------------------
// 轮询调度器
// ---------------------------------------------------------------------------

/**
 * 造一个轮询器。
 *
 * 回调约定（都不传也行）：
 *   load()            → Promise<{orders}>，默认走 api 拉一次订单
 *   onData(orders, d) → 每轮都调
 *   onChange(d, orders) → 只在「有变化」时调
 *   onError(err, fails) → 失败时调
 *   onTick(d, orders)   → 每轮都调（含无变化）
 *
 * @param {object} options
 * @param {string|function} [options.role] 'cook' / 'orderer'，或返回它的函数
 *        （传函数是为了身份切换后不用重建 watcher —— 每轮现读一次最准）
 */
function createWatcher(options) {
  const opts = options || {}
  const load = opts.load || defaultLoad

  function resolveRole() {
    const r = typeof opts.role === 'function' ? opts.role() : opts.role
    return r === 'cook' ? 'cook' : 'orderer'
  }

  const st = {
    timer: null,
    running: false,
    paused: false,
    busy: false,
    fails: 0,
    snap: null,
    orders: [],
    ticks: 0,
    role: '',
  }

  function interval() {
    return nextInterval(urgency(st.orders, st.role), st.fails)
  }

  function schedule(delay) {
    if (!st.running || st.paused) return
    if (st.timer) clearTimeout(st.timer)
    st.timer = setTimeout(run, typeof delay === 'number' ? delay : interval())
  }

  /**
   * 跑一轮。
   * @param {boolean} [force] 手动触发（下拉刷新）：跳过「已停止 / 已暂停」的拦截，
   *        但仍然防重入 —— 用户连点两下不会同时发两个请求。
   */
  async function run(force) {
    st.timer = null
    if (!force && (!st.running || st.paused)) return
    if (st.busy) return
    st.busy = true
    try {
      const res = await load()
      const orders = (res && res.orders) || []
      const next = snapshot(orders)
      const d = diff(st.snap, next)
      st.fails = 0
      st.orders = orders
      st.snap = next
      st.role = resolveRole()
      lastUrgency = urgency(orders, st.role)
      st.ticks += 1
      if (opts.onData) opts.onData(orders, d)
      if (opts.onChange && d.any) opts.onChange(d, orders)
      if (opts.onTick) opts.onTick(d, orders)
      emit(d, orders)
      notifyTabBar()
    } catch (err) {
      st.fails += 1
      if (opts.onError) opts.onError(err, st.fails)
      // 失败也要广播：页面靠它决定「要不要进错误态给个重试按钮」
      emit(null, null, err)
    } finally {
      st.busy = false
      // 失败时也要排期（否则断了网就再也不会自己接上）
      // schedule 内部已经判过 running / paused，暂停或停止时不会被重新唤醒
      schedule()
    }
  }

  return {
    role() {
      return st.role || resolveRole()
    },

    /** 启动：立刻拉一次，再按间隔循环 */
    start() {
      if (st.running) return
      st.running = true
      st.paused = false
      run()
    },

    /** 停止：清掉定时器（App onHide 调） */
    stop() {
      st.running = false
      if (st.timer) {
        clearTimeout(st.timer)
        st.timer = null
      }
    },

    isRunning() {
      return st.running
    },

    /**
     * 暂停：定时器停掉但保留「正在运行」的状态。
     * 用于页面开着弹层 / 正在编辑时 —— 这时候列表被轮询刷掉会把用户的操作顶飞。
     */
    pause() {
      st.paused = true
      if (st.timer) {
        clearTimeout(st.timer)
        st.timer = null
      }
    },

    /** 恢复：立刻补一次，再回到正常循环 */
    resume() {
      if (!st.paused) return
      st.paused = false
      if (st.running) run()
    },

    isPaused() {
      return st.paused
    },

    /**
     * 手动立刻拉一次（下拉刷新用），返回本次完成后的 Promise。
     * 暂停 / 停止状态下也能用 —— 用户主动的操作永远该被响应。
     */
    refresh() {
      if (st.timer) {
        clearTimeout(st.timer)
        st.timer = null
      }
      return run(true)
    },

    /**
     * 用户刚做了操作（推进状态）→ 把节奏重置，别等满一个间隔。
     * @param {number} [delay] 指定延迟；不传则用默认的 1.2 秒
     */
    nudge(delay) {
      if (!st.running || st.paused) return
      schedule(typeof delay === 'number' ? delay : 1200)
    },

    interval: interval,
    failCount() {
      return st.fails
    },
    orders() {
      return st.orders
    },
    snapshot() {
      return st.snap
    },
    tickCount() {
      return st.ticks
    },
  }
}

// 默认取数：走 utils/api，避免 live.js 直接依赖云 SDK 细节
function defaultLoad() {
  const api = require('./api')
  return api.call('listOrders')
}

// ---------------------------------------------------------------------------
// 全局单例：整个 App 只跑一个轮询器
// 好处有两个：底栏角标在任何 tab 页都准；也不会出现「两个页面各开一个」白烧请求
// ---------------------------------------------------------------------------
let current = null

/**
 * 开始监听（App onShow 调）。重复调用不会叠加定时器。
 * @returns {object} watcher
 */
function watch(options) {
  unwatch()
  current = createWatcher(options)
  current.start()
  return current
}

/** 停止监听（App onHide 调） */
function unwatch() {
  if (current) {
    current.stop()
    current = null
  }
}

/** 当前 watcher（可能在跑，也可能没有） */
function watching() {
  return current
}

/** 最近一轮拿到的订单列表；还没轮过返回空数组 */
function currentOrders() {
  return current ? current.orders() : []
}

/** 是否已经拿到过至少一轮数据（页面用它决定「直接画」还是「先转圈」） */
function hasData() {
  return !!(current && current.snapshot())
}

/** 暂停轮询（页面开弹层时调，记得配 resume） */
function pause() {
  if (current) current.pause()
}

/** 恢复轮询 */
function resume() {
  if (current) current.resume()
}

/** 下拉刷新：立刻补一轮 */
function refreshNow() {
  if (current) return current.refresh()
  return Promise.resolve()
}

module.exports = {
  INTERVALS,
  snapshot,
  diff,
  urgency,
  nextInterval,
  notice,
  badgeFor,
  lastInfo,
  createWatcher,
  subscribe,
  unsubscribe,
  watch,
  unwatch,
  watching,
  currentOrders,
  hasData,
  pause,
  resume,
  refreshNow,
}
