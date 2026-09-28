// 购物车与点菜人的本地存取
// 购物车是本机的临时状态；下单后会写入云端订单，两台手机都能看到
//
// 关于辣度：购物车条目以「菜 + 辣度」为唯一标识（key = dishId + '|' + spice），
// 因此同一道菜选了两种辣度会分成两条独立记录
// （比如「麻婆豆腐·微辣」x1 和「麻婆豆腐·特辣」x2）。
const CART_KEY = 'lovekitchen_cart'
const NICK_KEY = 'lovekitchen_nick'

/**
 * 购物车条目的唯一键。
 * 注意：这里不能只用 dishId —— 同菜不同辣度要分开算。
 * @param {object} it 购物车条目
 * @returns {string}
 */
function itemKey(it) {
  return String(it.dishId) + '|' + (it.spice || '不辣')
}

function getCart() {
  const cart = wx.getStorageSync(CART_KEY)
  if (!Array.isArray(cart)) return []
  // 兼容早期没有 spice 字段 / 没有 key 的历史数据
  return cart.map(function (it) {
    const spice = it.spice || '不辣'
    return Object.assign({}, it, { spice: spice, key: it.dishId + '|' + spice })
  })
}

function setCart(cart) {
  wx.setStorageSync(CART_KEY, cart)
}

/**
 * 加入购物车
 * @param {object} dish 菜品
 * @param {string} [spice] 用户选的辣度；不传则用菜品推荐辣度
 */
function addToCart(dish, spice) {
  const cart = getCart()
  const useSpice = spice || dish.spice || '不辣'
  const wantKey = String(dish.id) + '|' + useSpice

  const found = cart.find(function (it) {
    return itemKey(it) === wantKey
  })

  if (found) {
    found.qty += 1
  } else {
    cart.push({
      key: wantKey,
      dishId: dish.id,
      name: dish.name,
      emoji: dish.emoji,
      spice: useSpice,
      qty: 1,
    })
  }
  setCart(cart)
  return cart
}

/**
 * 改数量（按条目 key 定位，同菜不同辣度互不影响）
 * @param {string} key 条目唯一键
 * @param {number} delta +1 / -1
 */
function changeQty(key, delta) {
  let cart = getCart()
  const found = cart.find(function (it) {
    return itemKey(it) === key
  })
  if (!found) return cart
  found.qty += delta
  if (found.qty <= 0) {
    cart = cart.filter(function (it) {
      return itemKey(it) !== key
    })
  }
  setCart(cart)
  return cart
}

function removeFromCart(key) {
  const cart = getCart().filter(function (it) {
    return itemKey(it) !== key
  })
  setCart(cart)
  return cart
}

/**
 * 改某条目的辣度。若改后与已有条目重复则合并数量。
 * @param {string} key 原条目 key
 * @param {string} spice 新辣度
 */
function changeSpice(key, spice) {
  let cart = getCart()
  const idx = cart.findIndex(function (it) {
    return itemKey(it) === key
  })
  if (idx < 0) return cart

  const target = cart[idx]
  target.spice = spice
  const newKey = target.dishId + '|' + spice

  // 已经有同样「菜 + 辣度」的条目 → 合并
  const dupIdx = cart.findIndex(function (it, i) {
    return i !== idx && itemKey(it) === newKey
  })

  if (dupIdx >= 0) {
    cart[dupIdx].qty += target.qty
    cart.splice(idx, 1)
  } else {
    target.key = newKey
  }

  setCart(cart)
  return cart
}

function clearCart() {
  setCart([])
}

function cartCount() {
  return getCart().reduce(function (sum, it) {
    return sum + (it.qty || 0)
  }, 0)
}

function getNickname() {
  return wx.getStorageSync(NICK_KEY) || ''
}

function setNickname(nick) {
  wx.setStorageSync(NICK_KEY, nick)
}

module.exports = {
  itemKey,
  getCart,
  setCart,
  addToCart,
  changeQty,
  removeFromCart,
  changeSpice,
  clearCart,
  cartCount,
  getNickname,
  setNickname,
}
