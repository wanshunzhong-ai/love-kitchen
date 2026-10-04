// 购物车与「谁点的」的本地存取
// 购物车是本机的临时状态；下单后会写入云端订单，两台手机都能看到
//
// 两个标识，别混用：
//   uid = 这一行的「身份」，一旦建立永不改变 —— 改辣度、换菜、改备注都不动它
//   key = dishId|spice，表达「同一道菜 + 同一辣度只有一行」的合并规则
// 为什么要有 uid：改辣度会改 key、换菜会改 dishId，若拿 key 当身份，
// 用户连续操作时编辑面板就会跟丢这一行；uid 不变，面板永远能定位到它。
//
// 关于每道菜的备注（note）：它挂在「行」上，跟着这一行一起下单。
// 整单想说的话请用订单级 remark，两者在下单页各有一块输入区。

const { DISH_NOTE_MAX, ROLES, AVOID_MAX, INTRO_MAX } = require('./constants')
// 忌口的收敛规则只有一份定义（utils/avoids.js），本地存储与订单服务端共用
const avoidsLib = require('./avoids')

const CART_KEY = 'lovekitchen_cart'
const NICK_KEY = 'lovekitchen_nick'
const ROLE_KEY = 'lovekitchen_role'
const AVATAR_KEY = 'lovekitchen_avatar'
const MOOD_KEY = 'lovekitchen_mood'
const AVOID_KEY = 'lovekitchen_avoids'
const INTRO_KEY = 'lovekitchen_intro'

let _seq = 0

/** 生成一个不会被复用到的行身份 */
function newUid() {
  _seq += 1
  return 'u' + Date.now().toString(36) + _seq.toString(36) + Math.floor(Math.random() * 60466176).toString(36)
}

/** 备注统一收敛：去掉首尾空白、限长，非字符串一律当空 */
function normalizeNote(v) {
  return String(v === null || v === undefined ? '' : v).trim().slice(0, DISH_NOTE_MAX)
}

/**
 * 购物车条目的展示键。
 * 注意：这里不能只用 dishId —— 同菜不同辣度要分开算。
 * @param {object} it 购物车条目
 * @returns {string}
 */
function itemKey(it) {
  return String(it.dishId) + '|' + (it.spice || '不辣')
}

/**
 * 定位用身份：老数据没有 uid 时用 'k' + key 兜底。
 * 必须是确定性的 —— 若每次读取都现生成，编辑中的行会瞬间对不上号。
 */
function rowUid(it) {
  return it.uid || 'k' + itemKey(it)
}

// 兼容按 uid 定位（新代码）与按 key 定位（老调用/老测试）两种写法
function sameRow(it, id) {
  return rowUid(it) === id || itemKey(it) === id
}

function getCart() {
  const raw = wx.getStorageSync(CART_KEY)
  if (!Array.isArray(raw)) return []
  return raw.map(function (it) {
    const spice = it.spice || '不辣'
    const qty = Number(it.qty)
    const row = Object.assign({}, it, {
      spice: spice,
      qty: qty > 0 ? qty : 1,
      note: normalizeNote(it.note),
    })
    row.uid = rowUid(row)
    row.key = itemKey(row)
    return row
  })
}

function setCart(cart) {
  wx.setStorageSync(CART_KEY, cart)
}

/**
 * 加入购物车。合并只看「菜 + 辣度」，备注留在原行上。
 * @param {object} dish 菜品
 * @param {string} [spice] 用户选的辣度；不传则用菜品推荐辣度
 * @returns {string} 落到的行身份（uid）
 */
function addToCart(dish, spice) {
  const cart = getCart()
  const useSpice = spice || dish.spice || '不辣'
  const wantKey = String(dish.id !== undefined && dish.id !== null ? dish.id : dish.dishId) + '|' + useSpice

  const found = cart.find(function (it) {
    return itemKey(it) === wantKey
  })

  if (found) {
    found.qty += 1
    setCart(cart)
    return rowUid(found)
  }

  const row = {
    uid: newUid(),
    key: wantKey,
    dishId: dish.id !== undefined && dish.id !== null ? dish.id : dish.dishId,
    name: dish.name,
    emoji: dish.emoji,
    spice: useSpice,
    note: '',
    qty: 1,
  }
  cart.push(row)
  setCart(cart)
  return row.uid
}

/**
 * 改数量（按行定位，同菜不同辣度互不影响）
 * @param {string} id 行身份（uid，兼容旧的 key）
 * @param {number} delta +1 / -1
 * @returns {string} 操作后这一行的 uid；数量归零被移除时返回 ''
 */
function changeQty(id, delta) {
  const cart = getCart()
  const row = cart.find(function (it) {
    return sameRow(it, id)
  })
  if (!row) return ''

  row.qty += delta
  if (row.qty <= 0) {
    setCart(
      cart.filter(function (it) {
        return !sameRow(it, id)
      })
    )
    return ''
  }
  setCart(cart)
  return rowUid(row)
}

/** @returns {string} 恒为 ''（这行已经没了） */
function removeFromCart(id) {
  setCart(
    getCart().filter(function (it) {
      return !sameRow(it, id)
    })
  )
  return ''
}

/**
 * 改某行的辣度。若改后与另一行重复则合并数量。
 * 合并时：目标行没备注就继承被合并行的备注（别让用户白写）。
 * @returns {string} 合并 / 修改后活下来的那行 uid；找不到返回 ''
 */
function changeSpice(id, spice) {
  const cart = getCart()
  const idx = cart.findIndex(function (it) {
    return sameRow(it, id)
  })
  if (idx < 0) return ''

  const target = cart[idx]
  target.spice = spice
  const newKey = itemKey(target)

  const dupIdx = cart.findIndex(function (it, i) {
    return i !== idx && itemKey(it) === newKey
  })

  if (dupIdx >= 0) {
    const dup = cart[dupIdx]
    dup.qty += target.qty
    if (!dup.note && target.note) dup.note = target.note
    cart.splice(idx, 1)
    setCart(cart)
    return rowUid(dup)
  }

  target.key = newKey
  setCart(cart)
  return rowUid(target)
}

/**
 * 换一道菜（保留这一行的数量与 uid）。
 * 若换成的菜 + 辣度已经存在 → 合并数量，备注同样按「目标空则继承」处理。
 * @param {string} id 行身份
 * @param {object} dish 新菜品（需要 id 或 dishId / name / emoji / spice）
 * @returns {string} 换完后那一行的 uid；找不到返回 ''
 */
function replaceDish(id, dish) {
  const cart = getCart()
  const idx = cart.findIndex(function (it) {
    return sameRow(it, id)
  })
  if (idx < 0 || !dish) return ''

  const row = cart[idx]
  const dishId = dish.dishId !== undefined && dish.dishId !== null ? dish.dishId : dish.id
  row.dishId = dishId
  row.name = dish.name || row.name
  row.emoji = dish.emoji || row.emoji
  // 新菜有推荐辣度就用它，否则保留原来选的
  row.spice = dish.spice || row.spice || '不辣'
  row.key = itemKey(row)

  const dupIdx = cart.findIndex(function (it, i) {
    return i !== idx && itemKey(it) === row.key
  })

  if (dupIdx >= 0) {
    const dup = cart[dupIdx]
    dup.qty += row.qty
    if (!dup.note && row.note) dup.note = row.note
    cart.splice(idx, 1)
    setCart(cart)
    return rowUid(dup)
  }

  setCart(cart)
  return rowUid(row)
}

/**
 * 改某行的备注
 * @param {string} id 行身份
 * @param {string} note 备注（自动去掉首尾空白并限长）
 * @returns {string} 这一行的 uid；找不到返回 ''
 */
function setItemNote(id, note) {
  const cart = getCart()
  const row = cart.find(function (it) {
    return sameRow(it, id)
  })
  if (!row) return ''
  row.note = normalizeNote(note)
  setCart(cart)
  return rowUid(row)
}

function clearCart() {
  setCart([])
}

function cartCount() {
  return getCart().reduce(function (sum, it) {
    return sum + (it.qty || 0)
  }, 0)
}

/**
 * 资料按身份分开存：两个人在同一台手机上各有一份资料，
 * 以前共用一个 key，掌勺人一改会把干饭人下单的署名也带歪。
 *
 * 归一规则：只认 'cook' / 'orderer'；不传或没选过身份时按干饭人算
 * （老数据的语义就是干饭人那一份）。
 * @param {string} [role] 'cook' | 'orderer'
 * @returns {'cook'|'orderer'}
 */
function roleKey(role) {
  const r = role === 'cook' || role === 'orderer' ? role : getRole()
  return r === 'cook' ? 'cook' : 'orderer'
}

/**
 * 称呼存储 key（历史遗留命名，资料类字段统一用 profileKey）
 * @param {string} [role] 'cook' | 'orderer'
 */
function nickKeyOf(role) {
  return NICK_KEY + '_' + roleKey(role)
}

/**
 * 资料字段的存储 key：全局 key + 身份后缀。
 * @param {string} base 旧版全局 key（也是字段基名）
 * @param {string} [role] 身份；不传用当前身份
 */
function profileKey(base, role) {
  return base + '_' + roleKey(role)
}

/**
 * 读一份按身份存的资料。自己那份没设置过时，把旧版全局值迁给**干饭人**
 * （只迁一次，迁完就把旧 key 删掉 —— 否则干饭人清空忌口后旧值会把它「复活」）；
 * 掌勺人从空开始，各存各的。
 * @param {string} base 旧版全局 key
 * @param {string} [role] 身份；不传用当前身份
 * @param {function} isSet 判定「设置过」的谓词（'' / null / 空数组都算没设置过）
 */
function readProfile(base, role, isSet) {
  const r = roleKey(role)
  const own = wx.getStorageSync(profileKey(base, r))
  if (isSet(own)) return own
  const legacy = wx.getStorageSync(base)
  if (r === 'orderer' && isSet(legacy)) {
    wx.setStorageSync(profileKey(base, r), legacy)
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(base)
    return legacy
  }
  return own
}

/**
 * 读称呼。role 不传就用当前身份。
 *
 * 兼容老数据：旧版只有 NICK_KEY 一个 key，而它实际承载的一直是
 * 干饭人的署名（checkout 的「谁点的」、评价的 by 都读它）——
 * 所以旧值迁移给干饭人，只迁一次（读到时顺手写进新 key）。
 * 掌勺人的称呼从空开始，各存各的。
 */
function getNickname(role) {
  const r = role === 'cook' || role === 'orderer' ? role : getRole()
  const own = wx.getStorageSync(nickKeyOf(r))
  if (own) return own
  const legacy = wx.getStorageSync(NICK_KEY)
  if (legacy && r !== 'cook') {
    wx.setStorageSync(nickKeyOf(r), legacy)
    return legacy
  }
  return ''
}

function setNickname(nick, role) {
  const r = role === 'cook' || role === 'orderer' ? role : getRole()
  wx.setStorageSync(nickKeyOf(r), nick)
}

// ---------- 基本资料：头像 / 状态 / 忌口 / 介绍 ----------
// 全部按身份分开存（store.setAvatar 只写当前身份那一份），
// 于是「编辑其中一方的基本信息不会改动另一方」。

/** 头像路径（选完微信头像后已 saveFile 持久化；没设置过返回 ''） */
function getAvatar(role) {
  return (
    readProfile(AVATAR_KEY, role, function (v) {
      return !!v
    }) || ''
  )
}

function setAvatar(path, role) {
  if (path) wx.setStorageSync(profileKey(AVATAR_KEY, role), path)
}

/** 当前状态 key（'' = 还没选过） */
function getMood(role) {
  const mood = readProfile(MOOD_KEY, role, function (v) {
    return !!v
  })
  return mood && typeof mood === 'string' ? mood : ''
}

function setMood(key, role) {
  if (key) wx.setStorageSync(profileKey(MOOD_KEY, role), key)
}

/** 忌口清单：永远是干净字符串数组（收敛规则见 utils/avoids.js） */
function getAvoids(role) {
  return avoidsLib.normalize(
    readProfile(AVOID_KEY, role, function (v) {
      return Array.isArray(v) && v.length > 0
    })
  )
}

/** 存忌口清单：去重、限长、限量都由 avoids.normalize 保证 */
function setAvoids(list, role) {
  const clean = avoidsLib.normalize(list)
  wx.setStorageSync(profileKey(AVOID_KEY, role), clean)
  return clean
}

/** 加一条忌口：去重、限长、限量；已存在或满了返回 false */
function addAvoid(item, role) {
  const list = getAvoids(role)
  const text = avoidsLib.cleanOne(item)
  if (!text) return false
  if (list.indexOf(text) >= 0) return false
  if (list.length >= AVOID_MAX) return false
  list.push(text)
  setAvoids(list, role)
  return true
}

/** 按文本删一条忌口 */
function removeAvoid(item, role) {
  setAvoids(
    getAvoids(role).filter(function (it) {
      return it !== item
    }),
    role
  )
}

/** 个人介绍（一句话自我介绍，没写过返回 ''） */
function getIntro(role) {
  return (
    readProfile(INTRO_KEY, role, function (v) {
      return !!v
    }) || ''
  )
}

function setIntro(text, role) {
  const clean = String(text === null || text === undefined ? '' : text).trim().slice(0, INTRO_MAX)
  wx.setStorageSync(profileKey(INTRO_KEY, role), clean)
  return clean
}

// ---------- 身份（干饭人 / 掌勺人） ----------

/** @returns {'orderer'|'cook'|''} 未选过身份返回 '' */
function getRole() {
  const role = wx.getStorageSync(ROLE_KEY)
  return ROLES[role] ? role : ''
}

/**
 * 只接受合法身份，其他值一律忽略。
 * 切到掌勺人时顺手清空购物车：掌勺人不点单，
 * 避免之前以干饭人身份加的菜被掌勺人误下单。
 */
function setRole(role) {
  if (!ROLES[role]) return
  const prev = getRole()
  wx.setStorageSync(ROLE_KEY, role)
  if (role === 'cook' && prev !== 'cook') clearCart()
}

/** 身份 key → 展示信息（emoji / 文案 / 默认首页）；未选返回 null */
function getRoleInfo() {
  return ROLES[getRole()] || null
}

/**
 * 页面 onShow 的身份守卫：没选过身份就送去选择页。
 * @returns {string} 身份 key；返回空串时调用方应立即 return（页面正被替换）
 */
function ensureRole() {
  const role = getRole()
  if (!role) {
    wx.reLaunch({ url: '/pages/role-select/role-select' })
  }
  return role
}

module.exports = {
  itemKey,
  normalizeNote,
  getCart,
  setCart,
  addToCart,
  changeQty,
  removeFromCart,
  changeSpice,
  replaceDish,
  setItemNote,
  clearCart,
  cartCount,
  getNickname,
  setNickname,
  getAvatar,
  setAvatar,
  getMood,
  setMood,
  getAvoids,
  setAvoids,
  addAvoid,
  removeAvoid,
  getIntro,
  setIntro,
  getRole,
  setRole,
  getRoleInfo,
  ensureRole,
}
