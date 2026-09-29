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

// 订单状态下拉选项（编辑订单时用）
const ORDER_STATUS_OPTIONS = [
  { key: 'pending', text: '待开做', emoji: '📝' },
  { key: 'cooking', text: '开做中', emoji: '👩‍🍳' },
  { key: 'done', text: '已上菜', emoji: '🎉' },
]

// 辣度档位（level 决定 🌶️ 数量与标签配色）
const SPICE_LEVELS = [
  { key: '不辣', level: 0 },
  { key: '微辣', level: 1 },
  { key: '中辣', level: 2 },
  { key: '特辣', level: 3 },
]

// 用餐时段。endHour 是该时段的截止时刻（24 = 当天结束），
// 用于判断「今天」还剩哪些时段可以订：当前小时 < endHour 即可订。
const DINE_SLOTS = [
  { key: 'breakfast', text: '早餐', emoji: '🌅', endHour: 10 },
  { key: 'lunch', text: '午餐', emoji: '☀️', endHour: 15 },
  { key: 'dinner', text: '晚餐', emoji: '🌙', endHour: 21 },
  { key: 'midnight', text: '夜宵', emoji: '✨', endHour: 24 },
]

// 点菜可提前的最大天数（含今天，共 8 天可选）
const DINE_MAX_AHEAD_DAYS = 7

// 每道菜单独备注的字数上限（下单页「改这道菜」面板里用）
const DISH_NOTE_MAX = 20

// 每道菜备注的快捷短语：点一下就填进去，省得逐字打
const DISH_NOTE_TAGS = [
  '不放葱',
  '不要香菜',
  '少放盐',
  '少放油',
  '多放辣椒',
  '打包带走',
]

module.exports = {
  CATEGORIES,
  DISH_EMOJIS,
  ORDER_STATUS,
  ORDER_STATUS_OPTIONS,
  SPICE_LEVELS,
  DINE_SLOTS,
  DINE_MAX_AHEAD_DAYS,
  DISH_NOTE_MAX,
  DISH_NOTE_TAGS,
}
