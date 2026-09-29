// 全局常量：菜品分类、可选图标、订单状态
const CATEGORIES = [
  { key: '经典热菜', emoji: '🍖' },
  { key: '凉菜腌腊', emoji: '🥓' },
  { key: '汤羹煲', emoji: '🍲' },
  { key: '小吃点心', emoji: '🥟' },
  { key: '米粉主食', emoji: '🍜' },
  { key: '其他', emoji: '🍴' },
]

// 身份（首次进入二选一）：决定默认首页与操作权限
//   点餐人 → 默认进「点菜」，负责下单 / 改单，不推进做菜状态
//   做饭人 → 默认进「待做」（按日期看要做的菜），负责「开始做 / 做好了」推进状态
const ROLES = {
  orderer: { key: 'orderer', text: '点餐人', emoji: '🍽️', home: '/pages/menu/menu' },
  cook: { key: 'cook', text: '做饭人', emoji: '👩‍🍳', home: '/pages/todo/todo' },
}

/** 身份 key → 展示信息；非法 / 空值返回 null */
function roleInfo(key) {
  return ROLES[key] || null
}

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

/**
 * 辣度 → 展示信息。列表里「只显示选定的那一档」用它出文案与配色。
 * 纯函数，非法 / 空值一律按「不辣」处理（老数据里可能没有 spice 字段）。
 * @param {string} spice 辣度名
 * @returns {{ key: string, level: number, label: string }} level 用于配色（0~3）
 */
function spiceInfo(spice) {
  const key = String(spice || '不辣')
  const hit = SPICE_LEVELS.find(function (s) {
    return s.key === key
  })
  const level = hit ? hit.level : 0
  // 「不辣」不画辣椒，其余按档位画几颗
  return {
    key: key,
    level: level,
    label: level > 0 ? '🌶️'.repeat(level) + ' ' + key : key,
  }
}

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

// 当前状态（基本资料页选 mood，情绪小标签）
const MOODS = {
  happy: { key: 'happy', text: '开心', emoji: '😄' },
  plain: { key: 'plain', text: '平淡', emoji: '😐' },
  sad: { key: 'sad', text: '不开心', emoji: '🙁' },
  tired: { key: 'tired', text: '累了', emoji: '😪' },
  angry: { key: 'angry', text: '生气', emoji: '😤' },
  greedy: { key: 'greedy', text: '嘴馋', emoji: '🤤' },
}

/** 状态 key → 展示信息；非法 / 空值返回 null */
function moodInfo(key) {
  return MOODS[key] || null
}

// 忌口清单：条数与单条字数上限（基本资料页维护，做菜的人照着避雷）
const AVOID_MAX = 12
const AVOID_TEXT_MAX = 10

// 忌口快捷标签：点一下就加进清单
const AVOID_COMMON = [
  '香菜',
  '葱',
  '姜',
  '蒜',
  '辣椒',
  '海鲜',
  '香菇',
  '肥肉',
  '生冷',
  '花生',
]

// 个人介绍字数上限（「我的」页，一句话介绍自己）
const INTRO_MAX = 60

module.exports = {
  CATEGORIES,
  ROLES,
  roleInfo,
  DISH_EMOJIS,
  ORDER_STATUS,
  ORDER_STATUS_OPTIONS,
  SPICE_LEVELS,
  spiceInfo,
  DINE_SLOTS,
  DINE_MAX_AHEAD_DAYS,
  DISH_NOTE_MAX,
  DISH_NOTE_TAGS,
  MOODS,
  moodInfo,
  AVOID_MAX,
  AVOID_TEXT_MAX,
  AVOID_COMMON,
  INTRO_MAX,
}
