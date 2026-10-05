# 样式与组件架构（爱心小厨房）

> 本文件是 `app.wxss` 之外对**分层与组件契约**的完整说明。`MEMORY.md` 只保留两个「会静默失效的坑」和指针，改样式前**先读这里**。
> 相关技能：`miniprogram-style-compat`（真机走样 / 收敛公共层）、`miniprogram-role-permission`（按身份分工）。

## 分层

```
styles/common.wxss   设计 token，写在 page {} 上       → app.wxss @import（全局）
styles/state.wxss    空态三态零件                       → app.wxss @import（全局）
styles/sheet.wxss    弹层基座                           → 页面/组件按需 @import
styles/tap.wxss      按压反馈零件 .tap-hover            → app.wxss @import + 4 个组件各自 @import
```

### `styles/common.wxss` —— 设计 token

写在 `page {}` 上：`--brand` / `--brand-2` / `--grad-main`（由前两者拼出）/ `--grad-hero` / `--grad-done` / `--grad-pink` / `--grad-warn` / `--grad-panel` / `--radius-card` / `--radius-pill` / `--shadow-card` / `--shadow-float`；外加辣度皮肤 `.spice-0..3`。

**颜色 / 渐变 / 圆角 / 阴影只在这里写一次**，其余一律 `var()`。

### `styles/state.wxss` —— 空态零件

`.state` / `.state-emoji` / `.state-tip` / `.state-sub` / `.btn-retry`。
**刻意不用 `var()`、刻意不含 `page` 选择器** —— 组件的 wxss 里不能出现 `page` 选择器，而组件又必须能 `@import` 它。

### `styles/sheet.wxss` —— 弹层基座

`.mask` / `.sheet` / `.sheet-head|title|close|back|dish|emoji|name` / `.cats` / `.cat` / `.cat-active` + `@keyframes sheet-up`。
**不含 `page` 选择器**（组件要 import），可以用 `var()`。`pages/menu/menu.wxss` 与 `components/dish-picker` 都 `@import` 它 → **全仓库只剩一处 `.sheet` 定义**。

历史教训：menu 与 order-edit 曾各有一份且数值已漂移（底色 `#FFFCFB` vs `#FFF7F3`、padding `32/32/48` vs `28/24/40`、头部间距 `8rpx` vs `20rpx`）。

### `styles/tap.wxss` —— 按压反馈

```css
.tap-hover { opacity: 0.7; transform: scale(0.98); }
```

**不含 `page` 选择器、不用 `var()`**，理由同 state.wxss。

## 组件层

### `components/state-block`

三态结构组件：`emoji` / `tip` / `sub` / `retry`（**按钮文案**，留空即不出按钮），点按钮抛 `retry` 事件。

**8 个页面已全量替换**：orders / todo / menu / review / dish-edit / dish-logs / checkout / order-edit。
`pages/dish-import` 的成功页是唯一例外（只借 `.state` 做居中布局，结构不是三态）。

> **新增页面要写空态就用 `<state-block>`，别再手写 `class="state"`。**

### `components/cart-list`

菜品行（结算页 / 编辑订单页共用）。

- props：`items` / `spiceLevels` / `openKey` / `addText` / `hint`
- 事件：`act`（`detail { act, key, spice, delta }`，`act ∈ edit|open-spice|spice|note|qty|remove`）+ `add`
- **组件只渲染 + 转发，不 require 任何业务模块、不调 `wx.*`**
- 两页的数据字段名在页面侧归一：结算页补 `key = uid` 并把 `spiceLevel` 改名 `spiceIdx`；两页都有 `onCartAct` 分发器，下面的 handler 直接收 key。

### `components/dish-picker`

选菜弹层（编辑订单页「＋ 从菜单加菜」/ 改菜面板「🔄 换一道菜」共用）。

- **自己负责取菜单 + 分类 + 搜索 + 空态 + 分页**
- 选完只抛 `pick`（detail 带整道菜）**绝不自己关**
- props：`visible` / `title` / `emptyText` / `backText`（有值时头部出「← 返回」而不是 ✕）
- **「关闭时机归调用方」是刻意的**：编辑订单页要连加几道（不关），改菜面板选一道就回编辑态（关）。

## 分页

`utils/paging.js`（零依赖零副作用）：`PAGE_SIZE=30` / `initial` / `hasMore` / `grow` / `slice` / `clamp`。

落点 **2 处**：`pages/menu` + `components/dish-picker`（组件化后 order-edit / dish-editor 已不再直接渲染菜品列表，都走 dish-picker）。

**前缀不变式**：渲染列表永远是完整列表的 `slice(0, shown)` → wxml 里 `data-idx="{{index}}"` 与完整列表下标天然一致，分页**不会**让原有「按 index 取元素」错位。

## 两个会静默失效的坑

1. **页面样式表后加载，会覆盖全局同名类**（同样特异性时）。
   要统一某套皮肤时，不仅得删掉重复定义，**还得删掉页面里的覆盖声明** —— 例：`todo.wxss` 的 `.oi-spice { color:#ffffff }` 会盖掉全局 `.spice-0` 的字色，留着它统一就是白做。

2. **自定义组件的 wxss 里不能出现 `page` 选择器**（组件内没有 page 节点），所以 token 段和零件段必须拆两个文件。
   组件默认样式隔离，要用 `@import` 把零件引进去（**别指望 `styleIsolation: apply-shared`**）。
   **CSS 变量能穿透组件边界（继承属性），类名不能** —— 这也是选变量而不是「公共类」的原因。同理 `hover-class` 用的类也必须 `@import` 进每个组件。

## 接线约定

- **wxml 里属性名用 kebab-case，会自动转驼峰**（官方示例 `<component-tag-name inner-text="…">` ↔ `properties: { innerText }`）。所以 `spice-levels` / `open-key` / `add-text` / `back-text` 是对的写法。
- **官方还明确：组件 wxss 里不能用 ID / 属性 / 标签名选择器**（类选择器没问题）。
- **组件化后接线点变多，「点了没反应」最难查**：`test_batch4.js` F 组会把 wxml 里每个 `bind*/catch*="fn"` 的名字回查对应 js 里有没有定义。**扫 wxml 前必须去掉 `<!-- -->`**（`state-block.wxml` 头部注释里就有 `bind:retry="loadDishes"` 这种用法示例，会假红）。

## 兼容性约定（同 `app.wxss` 顶部）

- **不用 flex gap**（安卓 XWeb 低版本不支持，用负外边距容器替代）
- 安全区 `constant()+env()` 双写（全站合规，总量 17 处一一配对；改完可跑 `.workbuddy/tmp/fix_safe_area.py` 补漏，或跑 `test_p0_fixes.js` 的 A 组护栏）
- 字号下限 22rpx
- 自定义 tabBar 是原生层页面盖不住（用 `setHidden()` 让位）
- **按压反馈用 `hover-class` 而不是 CSS `:active`**（真机上 `:active` 常不触发）
