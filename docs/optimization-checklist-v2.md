# 优化清单 v2 · 可执行版

> 来源：`docs/full-review-2026-10-05.md`（全量审查第二版）。
> v1 清单（`page-optimization-checklist.md`）的 H1-H7 已实施；本清单**取代 v1 的第二、三节**，并补上审查新发现的**布局一致性 / 逻辑健壮性 / 架构层**三块。
> 共 **30 条**，按 `P0 → P5` 排序。每条可直接引用编号（例：「做 C1-C5」）。

**进度**：`5 / 30`　🔴 高优先 `5 → 0`　🟠 中 `13`　🟡 低 `9`　⚪ 待拍板 `3`

> **第 1 批（C1–C5）已于 2026-10-05 实施完成**，全量 1676 项断言全绿。

---

## P0 · 真机可见的隐患（改动量小，收益直接）✅ 第 1 批已完成

- [x] **C1 · 安全区补 `constant()` 兜底** — `小` ✅
  - 位置：`orders.wxss:6`、`todo.wxss:6`、`menu.wxss:6/337/355/412`、`checkout.wxss:6`、`order-edit.wxss:6/548`、`profile.wxss:10`、`dish-edit.wxss:6`、`review.wxss:7`、`dish-editor.wxss:23`、`custom-tab-bar/index.wxss:11`（**12 文件 / 14 处**）
  - 做法：每处在 `env()` 行**前**补一行同属性同数值的 `constant()`（脚本按行插入，已是双写的自动跳过）。
  - 验收：全仓库 `env` 与 `constant` 计数一致（18 = 18），`test_style_compat.js` 26/26，`test_p0_fixes.js` A 组 9 项全绿。

- [x] **C2 · `order-edit` 补 `loadError` 错误态** — `小` ✅
  - 位置：`pages/order-edit/order-edit.js:225-232`（原 catch）、`.wxml:8-13`
  - 做法：data 加 `loadError`；失败改 `setData({loading:false, loadError:true})`（不再 toast 后 `navigateBack`）；wxml 加 `wx:elif` 错误态复用全局 `.state` / `.state-sub` / `.btn-retry`；新增 `onRetry`。
  - 验收：B 组 10 项全绿（含「catch 里不再 navigateBack / 不再只 toast」）。

- [x] **C3 · `dish-import.loadExisting` 等就绪再解析** — `小` ✅
  - 位置：`pages/dish-import/dish-import.js`（`onLoad` / `loadExisting` / 新增 `ensureExisting` / `applyText`）、`utils/csv.js`（新增 `TEXT_MAX`）
  - 做法：`onLoad` 存下就绪 Promise；`applyText` 改 `async` 并 `await ensureExisting()`（失败会再试一次）；解析改用等到的 `existing`；菜单没拉回来时预览打 `⚠️` 警告；长度阈值 `200000` → `csv.TEXT_MAX`，文案由常量派生。
  - 验收：C 组 11 项全绿。

- [x] **C4 · `live.urgency` 改白名单计数** — `小` ✅
  - 位置：`utils/live.js:118-146`
  - 做法：`else pending += 1` → 显式 `else if (s === 'pending')`，认不出的状态记进新增的 `unknown`（不计入任何一档）；两处返回值都带上 `unknown`。
  - 验收：D 组 11 项全绿（未知状态 badge=0、urgent=false、active=false；缺 status 的老订单仍算 pending；正向路径没改坏）。

- [x] **C5 · 补 `pages/orders.js:478` 空 catch 的失败提示** — `小` ✅
  - 位置：`pages/orders/orders.js:473-486`
  - 修正：报告里原先写成 `utils/orders.js:478`，实际在**页面**（已同步改回两份文档）。
  - 做法：提前真删失败的 `.catch(function () {})` → `console.error` + `ui.toast('有一单没删干净，稍后再试一次')`（与定时器到点那条分支同一口径）。
  - 验收：E 组 3 项全绿。

---

## P1 · 性能（用得越久越明显）

- [ ] **C6 · 搜索防抖 200ms** — `小` 🟠
  - 位置：`pages/menu/menu.js:196-199`
  - 现状：每敲一个字全量过滤 303 道 + 整列表 setData；叠加频率排序时每字符还要 sort 一次。
  - 改法：`onSearchInput` 加 200ms 防抖，`setData` 只更新 `filteredDishes`；排序不在输入路径里做。
  - 验收：连打 5 个字符只触发 1 次过滤（可打日志验证）。

- [ ] **C7 · 长列表分页（三处共用）** — `中` 🟠
  - 位置：`pages/menu/menu.wxml:96`、`pages/order-edit/order-edit.wxml:261`、`components/dish-editor/dish-editor.wxml:80`
  - 现状：303 道菜全量渲染，无分页 / 虚拟列表。
  - 改法：抽一套「滚动到底 +30」的分页逻辑（`utils/paging.js` 纯函数 + 三页各接一次 `onReachBottom` / `bindscrolltolower`）。
  - 验收：首屏渲染 ≤ 40 项；滚动加载不重复不丢项。

- [ ] **C8 · 轮询瘦身** — `中` 🟠
  - 位置：`utils/orders.js::listOrders`（取最近 200 单全字段，含 3 个 jsonb）
  - 现状：15 秒一轮，payload 随使用时间单调增长；`frequency.js` 统计范围也被这 200 单绑死。
  - 改法：评估「只拉最近 N 天」或列表页裁掉 `items/reviews` 明细（详情页再按 id 取）。
  - 验收：连续使用一个月量级的假数据，单轮 payload 不随时间线性增长。
  - 备注：若改字段裁剪，注意 `frequency.js` 依赖 `items` → 需单独取一次统计用数据。

---

## P2 · 一致性（把复制粘贴收敛掉）

> **顺序有依赖**：C9 做完，C10 / C11 才有落点。

- [ ] **C9 · 新增 `styles/common.wxss` 承载设计 token** — `中` 🟠
  - 位置：新建文件 + 各页 `@import`
  - 现状：主渐变手写 **23 次**、`#FF7A9E` **39 次**、`#FF9F43` **24 次**、`border-radius` **116 处 10 档**、`box-shadow` 20 处（其中一条 2 处逐字相同）。
  - 改法：把「主渐变 / 主色 / 圆角 / 阴影 / Hero 渐变」各定义一次为公共类，各页改为引用。
  - 验收：全仓库 `linear-gradient(135deg, #FF7A9E` 出现次数 ≤ 3（仅 token 定义处）。

- [ ] **C10 · 删掉 `todo.wxss:261-294` 的本地重写** — `小` 🟠
  - 位置：`pages/todo/todo.wxss:261-294` vs `app.wxss:54-94`
  - 现状：整块重写且**数值已漂移**（padding / 字号 / 行高全不同），还**丢了 `.btn-retry::after { border:none }`** → 可能露出原生按钮边框。
  - 改法：删除本地重写，直接用全局 `.state` / `.btn-retry`。
  - 验收：待做页空态与订单页空态视觉一致。

- [ ] **C11 · 统一辣度皮肤（并入 C10）** — `小` 🟠
  - 位置：`pages/todo/todo.wxss:138-152`（另一套）vs `menu.wxss:206-224` / `order-edit.wxss:150-168` / `orders.wxss:253-271` / `review.wxss:157-175`（4 处逐字相同）
  - 现状：`todo` 只写 `background` 不写 `color`，色值全不同（`.spice-0` `#D9C6BF` vs 其余 `#F4EDE9`）→ 同一个「微辣」两页两个颜色。
  - 改法：辣度皮肤收进 `common.wxss`，5 处改为引用。
  - 验收：同一辣度在待做页与订单页颜色一致。

- [ ] **C12 · 抽 `state-block` 组件（三态）** — `中` 🟠
  - 位置：6 处各写一遍 —— `orders.wxml:24-39`、`todo.wxml:15-29`、`menu.wxml:65-88`、`review.wxml:26-35`、`dish-edit.wxml:2-12`、`dish-logs.wxml:23-39`
  - 现状：几乎同构的 `state-emoji / state-tip / state-sub / btn-retry`，无公共组件。
  - 改法：`components/state-block`（properties：`emoji` / `tip` / `sub` / `retry`，event：`retry`）。**先抽这个，性价比最高。**
  - 验收：6 页替换后 `audit_wxml.py` 通过，各页三态外观无变化。

- [ ] **C13 · 抽 `cart-list` 组件** — `中` 🟠
  - 位置：`checkout.wxml` ↔ `order-edit.wxml`（**26 个同名类整块重复**：`.cart-item` / `.ci-*` / `.step` / `.mask` / `.sheet` …）
  - 现状：两个页面在渲染同一套「购物车行 + 选菜弹层」，样式几乎逐块复制。
  - 改法：抽组件承载渲染与样式，两页只传数据与事件。
  - 验收：两页的购物车行外观逐像素一致（截图对比）。

- [ ] **C14 · 抽 `dish-picker` 组件** — `中` 🟠
  - 位置：`menu.wxss:393+` ↔ `order-edit.wxss:529+`；`dish-editor.wxml:65-94`
  - 现状：选菜弹层三处重复（`.mask` / `.sheet` / `.sheet-head` / `.sheet-close` / `.cats` / `.cat`）。
  - 改法：抽组件，并把 C15 的搜索框一并做进去。
  - 验收：三处弹层行为一致。

---

## P3 · 健壮性

- [ ] **C15 · 状态枚举收进 `constants.js`** — `小` 🟠
  - 位置：`orders.js:28-31/144-145/405/409/420/436`、`order-edit.js:64/184-187/582/738`、`todo.js:174` 等十余处字面量
  - 改法：`constants.js` 出 `ORDER_STATUS_KEYS`（或复用现有 `ORDER_STATUS`），全项目改为引用常量。
  - 验收：`grep -rn "'pending'"` 只命中 constants 与测试。

- [ ] **C16 · 补齐并发保护** — `小` 🟠
  - 位置：`pages/orders/orders.js:81`、`pages/todo/todo.js:71`（`startLive` 无防重入）；`pages/review/review.js:79`（`loadOrder` 无 in-flight）
  - 现状：`menu.js:86` 有 `if (this._unsub) return`；另两页**没有** → 连续调两次会覆盖 `this.unsub`、旧订阅泄漏（当前靠调用时序兜住，非代码保证）。`review.loadOrder` 被 `onLoad` / `onRetry` / `onPullDownRefresh` 三处调用，可并发。
  - 改法：照抄 `menu.js` 的防重入；`review` 加 `_loadingOrder` 标志。
  - 验收：三页各加一条断言 —— 连续两次 `startLive` 只生效一次。

- [ ] **C17 · 下标定位改 id 定位** — `小` 🟠
  - 位置：`pages/orders/orders.js:226-229`（`this.data.filteredOrders[idx]`）
  - 现状：`await` 期间若轮询全量重画，下标会错位（注释自认「改错单」）；虽按 id 兜了一道，源头仍是下标。
  - 改法：从 `dataset.id` 直接取 id，不再依赖下标。
  - 验收：`updateStatus` 只用 id 查目标单。

- [ ] **C18 · 魔法数字收口** — `小` 🟡
  - 位置：`setTimeout(...,800)` **13 处**（order-edit×7、dish-edit×3、review×2、checkout×1）；`6000` ×2（`orders.js:178`、`todo.js:141`）；`5000` ×1（`orders.js:496`）；`confirmColor:'#FF7A9E'` **7 处**；兜底署名 `'宝贝'` **4 处**；辣度默认 `'不辣'` **9+ 处**；`dish-import.js:169-170` 阈值 `200000` 与文案「20 万字符」两处硬编码
  - 改法：提到 `constants.js`（`TOAST_MS` / `UNDO_MS` / `CONFIRM_COLOR` / `DEFAULT_NAME` / `DEFAULT_SPICE` / `IMPORT_TEXT_MAX`）。
  - 验收：wxml 文案与阈值同源（改一处即生效）。

---

## P4 · 体验微调（可一次批量做掉）

- [ ] **C19 · M3「今天吃什么」尊重当前筛选** — `小` 🟡
  - 位置：`pages/menu/menu.js:347,352`（从**全部** dishes 随机）
  - 改法：优先 `filteredDishes`，为空回退全部。

- [ ] **C20 · M5 改菜时导航栏标题** — `小` 🟡
  - 位置：`pages/dish-edit/dish-edit.json:2`（固定「加菜」）
  - 改法：带 id 时 `setNavigationBarTitle('改菜')`（`order-edit.js:122` 是正面示范）。

- [ ] **C21 · M9 点已选 tab 早退** — `小` 🟡
  - 位置：`custom-tab-bar/index.js:81-85`
  - 改法：`if (this.data.selected === key) return`。

- [ ] **C22 · L3 成功跳转延时 800ms → 1500ms** — `小` 🟡
  - 位置：`pages/checkout/checkout.js:356-360`（1500ms 的 toast 看不完）。

- [ ] **C23 · L5 打星补 `transition`** — `小` 🟡
  - 位置：`pages/review/review.wxss:190-200`。

- [ ] **C24 · L6 loading 态禁用「今天吃什么」** — `小` 🟡
  - 位置：`pages/menu/menu.wxml:112`（loading 时仍可点，且基于旧 `dishes`）。

- [ ] **C25 · M7 选菜弹层加搜索框** — `中` 🟡
  - 位置：`pages/order-edit/order-edit.wxml:240-275`、`components/dish-editor/dish-editor.wxml:65-94`
  - 改法：复用 menu 搜索实现（含 C6 的防抖）；建议与 C14 一并做。

- [ ] **C26 · 全局按压反馈（`hover-class`）** — `小` 🟡
  - 位置：全项目 **0 处** `hover-class`；89 个 `bindtap` 中约 **69 个**落在 `view`/`text` 上（`menu.wxml:9/12/13/47/55/98/112/115`、`todo.wxml:71/72/73` …）
  - 改法：`app.wxss` 定义 `.tap-hover { opacity:.7; transform:scale(.98) }`，批量给可点 `view` 加 `hover-class="tap-hover"`（`<button>` 20 个自带原生态，不用加）。
  - 验收：真机点列表项有「按下去」反馈。

- [ ] **C27 · 关键入口补 `aria-label`** — `小` 🟡
  - 位置：全项目 **0 处** `aria-role` / `aria-label`
  - 改法：给 tab、主按钮、图标按钮补 `aria-role="button"` + `aria-label`。

---

## P5 · 架构与决策（需拍板，不宜顺手做）

- [ ] **C28 · 菜单是否上云共享** — `大` ⚪ **需拍板**
  - 位置：`data/dishes.js`（303 道内置）+ `dishes_override_v1` / `dishes_deleted_v1`（本地 storage，不上云）
  - 现状：干饭人加菜 / 改名 / 下架，**掌勺人手机不会变、也收不到**。菜单日志只让他**看得见**，对不齐。菜单页对两种身份都开维护入口 → 两边在维护**两份互不相干的清单**。
  - 两条路：**A. 保持本地**（0 代价，永远对不齐）／**B. 上云共享**（含双向同步、冲突处理、离线编辑——需新建 dishes 表、改写 `utils/dishes.js` 本地优先策略）。
  - 影响：会**放大**其他问题（两边菜单不同 → 日志越重要 → 云表越不可省 → 数据层越重）。

- [ ] **C29 · `dish_logs` 归档 / 分页** — `小` ⚪
  - 位置：`utils/dish-logs.js`（全量拉、按天分组）
  - 现状：append-only 且**无归档策略**，用得久了日志页越来越慢。
  - 改法：查询加「只取最近 N 天」或分页。

- [ ] **C30 · 清理云上残留 `dishes` 表** — `小` ⚪
  - 位置：云库 `public.dishes`（**101 行**，早期「菜单放云端」方案残骸，当前代码零引用）
  - 改法：若走 C28-A → `DROP TABLE`；若走 C28-B → 它是起点，保留。

---

## 附 · v1 清单复核结果

| v1 项 | 结论 | 证据 |
| --- | --- | --- |
| M1 搜索无防抖 | 仍然存在 → **C6** | `menu.js:196-199` |
| M2 长列表无分页 | 仍然存在 → **C7** | `menu.wxml:96` 等 3 处 |
| M3 随机忽略筛选 | 仍然存在 → **C19** | `menu.js:347,352` |
| M4 视觉不一致 | **部分修** → **C9/C10/C11** | 色值已统一，重复未收敛，todo 仍两套 |
| M5 dish-edit 标题 | 仍然存在 → **C20** | `dish-edit.json:2` |
| M6 profile toast 过频 | ✅ **已修** | `profile.js:36,103-112` |
| M7 选菜弹层无搜索 | 仍然存在 → **C25** | `order-edit.wxml:240-275` |
| M8 import 时序 | 仍然存在 → **C3** | `dish-import.js:52-69,183` |
| M9 tabBar 重复 switchTab | 仍然存在 → **C21** | `custom-tab-bar/index.js:81-85` |
| L1 无 hover-class | 仍然存在 → **C26** | 全仓库 0 处 |
| L2 无无障碍 | 仍然存在 → **C27** | 全仓库 0 处 |
| L3 800ms 跳转 | 仍然存在 → **C22** | `checkout.js:356-360` |
| L4 menu 并发保护 | ✅ **已修** | `menu.js:161-163` |
| L5 星星无 transition | 仍然存在 → **C23** | `review.wxss:190-200` |
| L6 loading 态可随机 | 仍然存在 → **C24** | `menu.wxml:112` |
| L7 评价区随轮询重建 | ✅ **已不适用** | review 已不订轮询 |

---

## 建议批次（每批一次提交 + 全量回归）

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 第 1 批 ✅ | C1–C5 | **已完成 2026-10-05**，全量 1676 项断言全绿 |
| 第 2 批 | C9–C11 + C12 | 先建 token 层，再做 state-block（两者独立可并行） |
| 第 3 批 | C6 + C22–C24 + C19–C21 | 体验与性能小项批量做 |
| 第 4 批 | C13 + C14 + C25 | 组件化三件套（cart-list / dish-picker + 搜索） |
| 第 5 批 | C15–C18 + C26 + C27 + C29 | 健壮性与无障碍收尾 |
| 待定 | C28 → 决定 C30 | 需要拍板 |

> 每批完成后跑：全量 `test_*.js` + `audit_wxml.py` + `audit_pack.py` + `test_style_compat.js`。
