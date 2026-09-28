// 购物车与点菜人的本地存取
// 购物车是本机的临时状态；下单后会写入云端订单，两台手机都能看到
const CART_KEY = 'lovekitchen_cart'
const NICK_KEY = 'lovekitchen_nick'

function getCart() {
  const cart = wx.getStorageSync(CART_KEY)
  return Array.isArray(cart) ? cart : []
}

function setCart(cart) {
  wx.setStorageSync(CART_KEY, cart)
}

function addToCart(dish) {
  const cart = getCart()
  const found = cart.find(function (it) {
    return it.dishId === dish.id
  })
  if (found) {
    found.qty += 1
  } else {
    cart.push({
      dishId: dish.id,
      name: dish.name,
      emoji: dish.emoji,
      spice: dish.spice || '不辣',
      qty: 1,
    })
  }
  setCart(cart)
  return cart
}

function changeQty(dishId, delta) {
  let cart = getCart()
  const found = cart.find(function (it) {
    return it.dishId === dishId
  })
  if (!found) return cart
  found.qty += delta
  if (found.qty <= 0) {
    cart = cart.filter(function (it) {
      return it.dishId !== dishId
    })
  }
  setCart(cart)
  return cart
}

function removeFromCart(dishId) {
  const cart = getCart().filter(function (it) {
    return it.dishId !== dishId
  })
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
  getCart,
  setCart,
  addToCart,
  changeQty,
  removeFromCart,
  clearCart,
  cartCount,
  getNickname,
  setNickname,
}
