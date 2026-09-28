// 全局常量：菜品分类、可选图标、订单状态
const CATEGORIES = [
  { key: '经典热菜', emoji: '🍖' },
  { key: '凉菜腌腊', emoji: '🥓' },
  { key: '汤羹煲', emoji: '🍲' },
  { key: '小吃点心', emoji: '🥟' },
  { key: '米粉主食', emoji: '🍜' },
  { key: '其他', emoji: '🍴' },
]

// 加菜时可以选的菜品图标
const DISH_EMOJIS = [
  '🍗', '🍖', '🥩', '🍤', '🦐', '🐟', '🥘', '🍛', '🥟', '🍜',
  '🍝', '🍲', '🥗', '🥬', '🥦', '🌽', '🍅', '🍆', '🥔', '🍚',
  '🍞', '🥪', '🌯', '🧆', '🍰', '🍮', '🧁', '🍨', '🍫', '🥤',
  '🌿', '🦆', '🎋', '🥢', '🍄', '🐷', '🐖', '🌰', '🥓', '🥕',
  '🥒', '🍘', '🥠', '🍥', '🥮', '🍠', '🌶️', '🍡',
]

// 订单状态
const ORDER_STATUS = {
  pending: { text: '待开做', emoji: '📝' },
  cooking: { text: '开做中', emoji: '👩‍🍳' },
  done: { text: '已上菜', emoji: '🎉' },
}

// 辣度档位（level 决定 🌶️ 数量与标签配色）
const SPICE_LEVELS = [
  { key: '不辣', level: 0 },
  { key: '微辣', level: 1 },
  { key: '中辣', level: 2 },
  { key: '特辣', level: 3 },
]

module.exports = { CATEGORIES, DISH_EMOJIS, ORDER_STATUS, SPICE_LEVELS }
