# 优化清单 v2 · 可执行版

> 来源：`docs/full-review-2026-10-05.md`（全量审查第二版）。
> v1 清单（`page-optimization-checklist.md`）的 H1-H7 已实施；本清单**取代 v1 的第二、三节**，并补上审查新发现的**布局一致性 / 逻辑健壮性 / 架构层**三块。
> 共 **30 条**，按 `P0 → P5` 排序。每条可直接引用编号（例：「做 C1-C5」）。

**进度**：`27 / 30`　🔴 高优先 `5 → 0`　🟠 中 `1`　🟡 低 `0`　⚪ 待拍板 `2`

> **第 1 批（C1–C5）已于 2026-10-05 实施完成**，全量 1676 项断言全绿。
> **第 2 批（C9–C11 + C12）已于 2026-10-05 实施完成**：新增 `styles/common.wxss`（token）+ `styles/state.wxss`（空态）两个公共层与 `components/state-block` 组件，新增 `test_batch2.js` 91 项，全量断言全绿。
> **第 3 批（C6 + C19–C24）已于 2026-10-05 实施完成**：搜索防抖 / 随机尊重筛选 / 改菜标题 / tabBar 早退 / toast 延时唯一来源 / 打星过渡 / loading 禁用，新增 `test_batch3.js` 37 项（含行为测试），全量断言全绿。
> **第 4 批（C13 + C14 + C25）已于 2026-10-05 实施完成**：组件化三件套 —— `styles/sheet.wxss`（弹层基座）+ `utils/dish-search.js`（搜索规则唯一来源）+ `components/cart-list` + `components/dish-picker`（含搜索），新增 `test_batch4.js` 132 项，全量 **1949 项**断言全绿。
> **第 5 批（C7 + C15–C18 + C26 + C27 + C29）已于 2026-10-05 实施完成**：`utils/paging.js`（长列表分页）+ `constants.STATUS`（状态枚举唯一来源，js / wxml 双向收口）+ `styles/tap.wxss`（按压反馈）+ 并发保护 + id 定位 + 魔法值收口 + `dish_logs` 时间窗，新增 `test_batch5.js` 100 项，全量 **2050 项**断言全绿。
> 余下 3 条：`C8`（轮询瘦身）与 `C28` / `C30`（菜单是否上云共享，**需拍板**）。

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

- [x] **C6 · 搜索防抖 200ms** — `小` 🟠 ✅ 第 3 批
  - 位置：`pages/menu/menu.js:196-199`
  - 现状：每敲一个字全量过滤 303 道 + 整列表 setData；叠加频率排序时每字符还要 sort 一次。
  - 改法：`onSearchInput` 加 200ms 防抖，`setData` 只更新 `filteredDishes`；排序不在输入路径里做。
  - 验收：连打 5 个字符只触发 1 次过滤（可打日志验证）。
  - **已实施**：提成常量 `SEARCH_DEBOUNCE = 200` + `scheduleFilter()` / `cancelSearchDebounce()` 两个方法。
    关键点：**keyword 仍然立刻 `setData`**（输入框受控，慢一拍文字/光标会跳、✕ 按钮也不及时），只有过滤延后；
    清空搜索 / 切分类 / `onHide` / `onUnload` 四处必须调 `cancelSearchDebounce()` —— 不调会出现
    「已经清空了，200ms 后又按旧关键词过滤一遍」。

- [x] **C7 · 长列表分页（三处共用）** — `中` 🟠 ✅ 第 5 批
  - 位置：`pages/menu/menu.wxml`、`components/dish-picker/dish-picker.wxml`（组件化后 order-edit / dish-editor 已不再直接渲染菜品列表，都走 dish-picker，所以落点是**两处**而不是原清单写的三处）
  - 现状：303 道菜全量渲染，低端机上滚动发涩。
  - **已实施**：新增 `utils/paging.js`（`PAGE_SIZE = 30` / `initial` / `hasMore` / `grow` / `slice` / `clamp`，纯函数零依赖）。
    **关键不变式**：渲染的列表永远是完整列表的**前缀**（`slice(0, shown)`），所以 wxml 里 `data-idx="{{index}}"` 与完整列表的下标天然一致 —— 分页不会让原有「按 index 取元素」的代码错位。
    菜单页接 `onReachBottom`（页面级滚动），弹层接 `scroll-view` 的 `bindscrolltolower`；筛选结果变化时 `resetPaging` 回到第一页。
  - 顺手把两处的「按下标取元素」改成**按 id 回查**（分页 + 频率重排下更稳）。
  - 验收：`test_batch5.js` A/B/C 组 —— 首屏 30 项（≤ 40）、滚到底 +30、封顶不越界、筛选后回到第一页、id 查不到不抛事件。

- [ ] **C8 · 轮询瘦身** — `中` 🟠
  - 位置：`utils/orders.js::listOrders`（取最近 200 单全字段，含 3 个 jsonb）
  - 现状：15 秒一轮，payload 随使用时间单调增长；`frequency.js` 统计范围也被这 200 单绑死。
  - 改法：评估「只拉最近 N 天」或列表页裁掉 `items/reviews` 明细（详情页再按 id 取）。
  - 验收：连续使用一个月量级的假数据，单轮 payload 不随时间线性增长。
  - 备注：若改字段裁剪，注意 `frequency.js` 依赖 `items` → 需单独取一次统计用数据。

---

## P2 · 一致性（把复制粘贴收敛掉）

> **顺序有依赖**：C9 做完，C10 / C11 才有落点。

- [x] **C9 · 新增 `styles/common.wxss` 承载设计 token** — `中` ✅
  - 位置：新建 `styles/common.wxss` + `styles/state.wxss`；`app.wxss` 顶部两行 `@import`
  - 现状：主渐变手写 **23 次**、`#FF7A9E` **39 次**、`#FF9F43` **24 次**、`border-radius` **116 处 10 档**、`box-shadow` 20 处（其中一条 2 处逐字相同）。
  - 做法：**改用 CSS 变量而不是公共类** —— 变量是继承属性，能穿透自定义组件边界（background 之类的类名做不到），且 `var()` 的支持度远高于 flex gap。token：`--brand` / `--brand-2` / `--grad-main`（由前面两个拼出）/ `--grad-hero` / `--grad-done` / `--grad-pink` / `--grad-warn` / `--grad-panel` / `--radius-card` / `--radius-pill` / `--shadow-card` / `--shadow-float`，共 14 个文件 90 处替换（脚本 `.workbuddy/tmp/refactor_c9.py`，全部同值等价）。
  - 圆角只收高频两档（999/24rpx），其余零散档位保持原值以免改变视觉。
  - 验收：全仓库 `linear-gradient(135deg, #FF7A9E` 出现次数 **0**（目标 ≤ 3，因为 `--grad-main` 直接由 `var(--brand)` 拼出，连 token 处都没有字面量）；`#FF7A9E` / `#FF9F43` 字面量只剩 token 定义那 2 行。

- [x] **C10 · 删掉 `todo.wxss:261-294` 的本地重写** — `小` ✅
  - 位置：`pages/todo/todo.wxss` vs `styles/state.wxss`
  - 现状：整块重写且**数值已漂移**（padding 100 vs 120rpx、字号 27/23 vs 28/24rpx），还**丢了 `.btn-retry::after { border:none }`** → 会露出原生按钮边框。
  - 做法：删除本地重写，改用公共层唯一一份；空态样式拆到 `styles/state.wxss`（不含 page 选择器），让 `state-block` 组件能 `@import` 它。
  - 验收：`todo.wxss` 不再定义 `.state` / `.state-*` / `.btn-retry`；`state.wxss` 保留 `::after` 清边框。

- [x] **C11 · 统一辣度皮肤（并入 C10）** — `小` ✅
  - 位置：`pages/todo/todo.wxss`（另一套）vs `menu.wxss` / `order-edit.wxss` / `orders.wxss` / `review.wxss`（4 处逐字相同）
  - 现状：`todo` 只写 `background` 不写 `color`（靠 `.oi-spice` 的 `color:#ffffff` 兜），色值全不同（`.spice-0` `#D9C6BF` vs 其余 `#F4EDE9`）→ 同一个「微辣」两页两个颜色。
  - 做法：四档皮肤收进 `styles/common.wxss`；5 处本地定义全删；**同时删掉 todo `.oi-spice` 的 `color:#ffffff`** —— 页面样式表后加载，不删的话它会盖掉全局皮肤，统一无效（这是本次最容易漏的一步）。
  - 验收：全仓库只有 `common.wxss` 定义 `.spice-0..3`；四档都有底色 + 字色。
  - ⚠️ **视觉变动（有意）**：待做页的辣度标签从「实心深底 + 白字」变成「浅底 + 深字」，与订单页同款。

- [x] **C12 · 抽 `state-block` 组件（三态）** — `中` ✅
  - 位置：**实际 21 处（9 个页面）**，清单原先只列了 6 处 —— 补上 `checkout.wxml`（空购物车）、`order-edit.wxml`（2 处）、`menu.wxml` 的 4 处。
  - 现状：几乎同构的 `state-emoji / state-tip / state-sub / btn-retry`，无公共组件。
  - 做法：`components/state-block`（properties：`emoji` / `tip` / `sub` / `retry`，event：`retry`；`retry` 是按钮文案，留空即不出按钮）。**替换 8 个页面共 20 处**；`dish-import` 的成功页只借 `.state` 做居中布局、结构不是三态，**保留全局类不套组件**（否则得给它开 slot，得不偿失）。
  - 验收：`audit_wxml.py` 通过；8 页 `usingComponents` 注册齐全；8 页 wxml 不再出现 `class="state"` / `class="btn-retry"` / 裸 `bindtap="onRetry"`。

- [x] **C13 · 抽 `cart-list` 组件** — `中` ✅
  - 位置：`checkout.wxml` ↔ `order-edit.wxml`（**26 个同名类整块重复**：`.cart-item` / `.ci-*` / `.step` / `.add-more`）
  - 现状：两个页面在渲染同一套「购物车行」，样式逐块复制。
  - **已实施**：新增 `components/cart-list`。props = `items` / `spiceLevels` / `openKey` / `addText` / `hint`；事件 = `act`（`detail { act, key, spice, delta }`，`act ∈ edit|open-spice|spice|note|qty|remove`）+ `add`。
  - 两页的数据字段名在页面侧归一：结算页补 `key = uid`、`spiceLevel → spiceIdx`；编辑订单页本来就是 `key` / `spiceIdx`。页面新增 `onCartAct` 分发器，下面每个 handler 改成**直接收 key**（不再各自掏 dataset）。
  - 验收：两页 wxss 分别 3.9KB → 0.9KB、9.7KB → 4.4KB；`test_batch4.js` E 组钉住「全仓库只有一处渲染 `class="cart-item"`」。

- [x] **C14 · 抽 `dish-picker` 组件** — `中` ✅
  - 位置：`order-edit` 的「＋ 从菜单加菜」↔ `dish-editor` 的「🔄 换一道菜」（两处各自加载菜单、各自写一遍分类过滤）
  - **已实施**：新增 `components/dish-picker`，组件自己负责**取菜单 + 分类 + 搜索 + 空态**；选完只抛 `pick`（detail 带整道菜）**不自己关闭** —— 编辑订单页要连加几道、改菜面板要选一道就回编辑态，关闭时机归调用方。
  - `backText` 属性：有值时头部出「← 返回」而非 ✕（改菜面板用它回编辑态）。
  - 顺带新增 `styles/sheet.wxss` 承载弹层基座（`.mask` / `.sheet` / `.sheet-head*` / `.cats` / `.cat*`），`menu.wxss` 与组件都 `@import` 同一份 → 全仓库只剩一处 `.sheet` 定义。菜单页的辣度弹层因此拿到了上滑动画，底色/padding 与选菜弹层统一。
  - 验收：`test_batch4.js` B/D 组；`audit_wxml.py` 通过（16 个 wxml）。
  - **C25（选菜弹层加搜索框）一并做了**，搜索框就落在这个组件里，见下方 P4 段的 C25 条目。

---

## P3 · 健壮性

- [x] **C15 · 状态枚举收进 `constants.js`** — `小` 🟠 ✅ 第 5 批
  - 位置：`orders.js` / `live.js` / `frequency.js` / `reject.js` / `deadline.js` / `todo.js` / `review.js` + 四个页面 + 三个 wxml —— 共 **12 个 js + 3 个 wxml、约 75 处**字面量（原清单只列了十余处）
  - **已实施**：`constants.js` 出 `STATUS`（四个键）与 `ACTIVE_STATUSES`（不含已驳回的三个，供 `ORDER_STATUSES` / `COUNT_STATUSES` 派生）。
    js 侧脚本 `refactor_c15.py` 统一替换（含 require 注入）；**模板侧不能 require 常量**，所以页面把 `STATUS` 挂成 `data.statusKeys`，wxml 写 `statusKeys.pending`（脚本 `refactor_c15_wxml.py`）。
  - ⚠️ **踩到的真坑**：`utils/orders.js` 里 `ORDER_STATUSES` 在文件前部、而 `require('./constants')` 在后部 —— `const` 没有变量提升，模块加载时直接 **TDZ 报错**（`Cannot access 'STATUS' before initialization`），整个 app require 链全炸。已把常量 require 提到 `ORDER_STATUSES` 之前。**新加常量时先确认 import 在使用之前**。
  - 验收：`grep -rn "'(pending|cooking|done|rejected)'" pages components utils` 只命中 `utils/constants.js`；`test_batch5.js` D 组（含「全项目 0 处字面量」扫描 + `ORDER_STATUSES` / `COUNT_STATUSES` / `REJECTABLE` 三条派生断言 + 三页 `statusKeys` 接线）。

- [x] **C16 · 补齐并发保护** — `小` 🟠 ✅ 第 5 批
  - 位置：`pages/orders/orders.js`、`pages/todo/todo.js` 的 `startLive`（无防重入）；`pages/review/review.js` 的 `loadOrder`（无 in-flight）
  - **已实施**：两处 `startLive` 开头照抄 `menu.js` 的 `if (this.unsub) return`（否则后一次订阅覆盖前一次的 `unsub`，旧订阅永久泄漏）；`loadOrder` 加 `_loadingOrder` 标志 + `finally` 复位（`onLoad` / `onRetry` / 下拉刷新三处都会调）。
  - 验收：`test_batch5.js` E 组 —— 静态断言 + **行为测试**（连调 3 次 `startLive` 只订阅 1 次；in-flight 时 `loadOrder` 不重置 `loading` 且仍返回 thenable，下拉刷新的 `finally` 不会炸）。

- [x] **C17 · 下标定位改 id 定位** — `小` 🟠 ✅ 第 5 批
  - 位置：`pages/orders/orders.js`（`filteredOrders[idx]`）
  - **已实施**：新增 `findOrder(id)`（查**全量** `orders`，不是 `filteredOrders` —— 单子可能因状态变化被筛出，但用户点的确实是它）；`updateStatus(id, nextStatus)` 与七个动作 handler 全部改收 `dataset.id`；wxml 的 `data-idx="{{index}}"` 全换成 `data-id="{{item.id}}"`。
  - 为什么必须改：`await` 写库期间轮询可能已全量重画，回来时下标可能指向另一单 →「点 A 开工、B 变了状态」。
  - 验收：`test_batch5.js` F 组（`findOrder` 存在 + `updateStatus` 收 id + 0 处 `filteredOrders[dataset.idx]` + 七个 handler 都按 id + wxml 无 `data-idx`）。

- [x] **C18 · 魔法数字收口** — `小` 🟡 ✅ 第 5 批
  - 「toast 后跳走」的 13 处 `800` 已在 **C22** 统一成 `ui.TOAST_DURATION`；导入阈值已在 **C3** 统一成 `csv.TEXT_MAX`。本批收口其余四类：
  - **已实施**（脚本 `refactor_c18.py`）：`CONFIRM_COLOR`（`confirmColor: '#FF7A9E'` 7 处 → 常量，全站 `#FF7A9E` 现在只在 `constants.js` 出现一次）、`DEFAULT_NAME`（`'宝贝'` 9 处）、`DEFAULT_SPICE`（`'不辣'` 默认值 20+ 处，**由 `SPICE_LEVELS[0].key` 派生**而不是再写一遍字面量）、`NOTICE_MS = 6000`（提示条自动收起 ×2）、`UNDO_MS = 5000`（删单撤销窗口）。
  - 模板侧默认辣度同理挂成 `data.defaultSpice`（菜单页 / 选菜弹层），订单页兜底署名挂成 `data.defaultName`。
  - 保留不动的：`utils/csv.js` 里的 `'不辣'`（那是**数据值 / 解析默认值**，不是界面散数字）、`data/dishes.js` 的辣度值。
  - 验收：`test_batch5.js` G 组（`#FF7A9E` 唯一出处 + `confirmColor` 0 处字面量 + `'宝贝'` 0 处 + `NOTICE_MS` / `UNDO_MS` + `DEFAULT_SPICE` 派生 + 导入阈值不回归）。

---

## P4 · 体验微调（可一次批量做掉）

- [x] **C19 · M3「今天吃什么」尊重当前筛选** — `小` 🟡 ✅ 第 3 批
  - 位置：`pages/menu/menu.js:347,352`（从**全部** dishes 随机）
  - 改法：优先 `filteredDishes`，为空回退全部。
  - **已实施**：`scoped = filteredDishes.length > 0`，有筛选就用它，为空回退全部菜单
    （否则会出现「搜了个词没结果，连随机都点不动」）。

- [x] **C20 · M5 改菜时导航栏标题** — `小` 🟡 ✅ 第 3 批
  - 位置：`pages/dish-edit/dish-edit.json:2`（固定「加菜」）
  - 改法：带 id 时 `setNavigationBarTitle('改菜')`（`order-edit.js:122` 是正面示范）。
  - **已实施**：`onLoad` 里带 id 才设（新增场景继续用 json 的静态标题）。

- [x] **C21 · M9 点已选 tab 早退** — `小` 🟡 ✅ 第 3 批
  - 位置：`custom-tab-bar/index.js:81-85`
  - 改法：`if (this.data.selected === key) return`。
  - **已实施**：`index.wxml` 补 `data-key="{{item.key}}"`（原来只传了 path），`onTap` 里早退。
    tab 是**按 key** 判断而不是 path —— 干饭人的「点单」与掌勺人的「菜单」是同一个 path。

- [x] **C22 · L3 成功跳转延时 800ms → 1500ms** — `小` 🟡 ✅ 第 3 批
  - 位置：`pages/checkout/checkout.js:356-360`（1500ms 的 toast 看不完）。
  - **已实施**：范围比清单写的大 —— 全仓库 **12 处**「toast 后跳走」的 `setTimeout(…, 800)`
    （checkout 1 / dish-edit 3 / order-edit 6 / review 2）都是同一个毛病。
    在 `utils/ui.js` 提成 `TOAST_DURATION = 1500` 并导出，12 处统一引用，`toast()` 自己的默认时长也用它
    —— 两边写死各自的数字迟早漂移。

- [x] **C23 · L5 打星补 `transition`** — `小` 🟡 ✅ 第 3 批
  - 位置：`pages/review/review.wxss:190-200`。
  - **已实施**：`.rv-star` 加 `transition: color 0.15s ease`（连点几颗星时颜色是跳变的）。

- [x] **C24 · L6 loading 态禁用「今天吃什么」** — `小` 🟡 ✅ 第 3 批
  - 位置：`pages/menu/menu.wxml:112`（loading 时仍可点，且基于旧 `dishes`）。
  - **已实施**：`onRandom` 开头挡 `loading`；按钮加 `.lucky-off`（opacity .45）示意不可点。

- [ ] **C25 · M7 选菜弹层加搜索框** — `中` ✅
  - 位置：`pages/order-edit/order-edit.wxml:248-283`、`components/dish-editor/dish-editor.wxml:65-94`
  - **已实施**：搜索框落在新抽的 `components/dish-picker` 里（与 C14 一并做的），两个入口（加菜 / 换菜）同时受益。
  - 规则与防抖都取自新抽的 `utils/dish-search.js`（`DEBOUNCE = 200` 与菜单页**同一个值**）：`hay()` 拼检索串并缓存、`filterBy(list, category, keyword)` 分类 + 多关键词。**menu.js 里那份复刻实现已删除**；`test_menu_search.js` 也从「测副本」改为「测真实现」（原先它复刻了一份算法，真实现漂移了它不会红）。
  - 验收：`test_batch4.js` D 组行为测试（连打 5 个字符只过滤 1 次 / 清空立即生效且迟到的定时器作废 / 切分类立即生效 / 关掉时清关键词但保留分类）。

- [x] **C26 · 全局按压反馈（`hover-class`）** — `小` 🟡 ✅ 第 5 批
  - 位置：全项目原 **0 处** `hover-class`
  - **已实施**：新增 `styles/tap.wxss`（`.tap-hover { opacity: .7; transform: scale(.98) }`），`app.wxss` 全局 `@import`；**4 个组件（cart-list / dish-editor / dish-picker / custom-tab-bar）各自 `@import` 一次** —— 组件样式默认隔离，全局类进不去。
    脚本 `add_hover_aria.py` 按标签扫描（不是按行，属性常分几行写），给可点的 `<view>` / `<text>` 补 `hover-class="tap-hover"`：**87 处**。
  - 刻意排除：`<button>`（自带原生态按压）、遮罩 `.mask`（按下去整块变暗很怪）、`noop` 空处理函数（弹层内容区防穿透）。
  - 验收：`test_batch5.js` H 组（文件 + `@import` 齐全 + 覆盖 ≥ 60 处 + 遮罩上 0 处 + button 0 处）。

- [x] **C27 · 关键入口补 `aria-label`** — `小` 🟡 ✅ 第 5 批
  - 位置：全项目原 **0 处** `aria-role` / `aria-label`
  - **已实施**：脚本给同一批可点元素补 `aria-role="button"`（**87 处**）；再对**只有图标、没有可见文字**的控件补 `aria-label`（13 处，脚本 `add_aria_label.py`）：搜索清空 ✕、弹层关闭 ✕、菜品行 ✏️/✕、步进器 −/＋、改辣度、打星、tab。
  - 有可见文字的按钮不再重复加 `aria-label`（文字本身就是可访问名，重复反而啰嗦）。
  - 验收：`test_batch5.js` I 组（`aria-role` 覆盖 ≥ 60 + 9 个纯图标控件的具体断言 + 步进器 + 打星）。

---

## P5 · 架构与决策（需拍板，不宜顺手做）

- [ ] **C28 · 菜单是否上云共享** — `大` ⚪ **需拍板**
  - 位置：`data/dishes.js`（303 道内置）+ `dishes_override_v1` / `dishes_deleted_v1`（本地 storage，不上云）
  - 现状：干饭人加菜 / 改名 / 下架，**掌勺人手机不会变、也收不到**。菜单日志只让他**看得见**，对不齐。菜单页对两种身份都开维护入口 → 两边在维护**两份互不相干的清单**。
  - 两条路：**A. 保持本地**（0 代价，永远对不齐）／**B. 上云共享**（含双向同步、冲突处理、离线编辑——需新建 dishes 表、改写 `utils/dishes.js` 本地优先策略）。
  - 影响：会**放大**其他问题（两边菜单不同 → 日志越重要 → 云表越不可省 → 数据层越重）。

- [x] **C29 · `dish_logs` 归档 / 分页** — `小` ⚪ ✅ 第 5 批
  - 位置：`utils/dish-logs.js::list`（原全量拉 + 按天分组）
  - **已实施**：两道闸门 —— ① **时间窗** `event.days`（默认 `DEFAULT_DAYS = 30` 天，`clampDays` 收敛到合法区间，上限 `DAYS_MAX = 365`），查询加 `.gte('created_at', since)`，**窗口在服务端生效**而不是拉全再本地裁；② 条数上限 `MAX_LOGS = 200` 保留。返回值带上 `days` 与 `capped`（是否顶到条数上限）。
  - 日志页把 `days` 传下去，底部给「只显示最近 N 天（已达条数上限，只列最新的）」提示；「看更早的」一次把窗口 **×3**（30 → 90 → 270 → 封顶 365），不一次拉到头 —— 绝大多数时候只看最近的，窗口够用时不必付那份流量。
  - 验收：`test_batch5.js` J 组（导出 + 默认值 + `clampDays` 六种脏输入 + `.gte` 在案 + 页面传参 + 扩窗逻辑 + wxml 提示）。

- [ ] **C30 · 清理云上残留 `dishes` 表** — `小` ⚪
  - 位置：云库 `public.dishes`（**101 行**，早期「菜单放云端」方案残骸，当前代码零引用）
  - 改法：若走 C28-A → `DROP TABLE`；若走 C28-B → 它是起点，保留。

---

## 附 · v1 清单复核结果

| v1 项 | 结论 | 证据 |
| --- | --- | --- |
| M1 搜索无防抖 | ✅ **已修（C6）** | `menu.js` 的 `scheduleFilter` / `cancelSearchDebounce` |
| M2 长列表无分页 | 仍然存在 → **C7** | `menu.wxml:96` 等 3 处 |
| M3 随机忽略筛选 | ✅ **已修（C19）** | `menu.js` 的 `onRandom` 优先取 `filteredDishes` |
| M4 视觉不一致 | ✅ **已修（C9/C10/C11）** | token 收敛、辣度皮肤合一、todo 本地重写删除 |
| M5 dish-edit 标题 | ✅ **已修（C20）** | `dish-edit.js` 的 `onLoad` 带 id 时设「改菜」 |
| M6 profile toast 过频 | ✅ **已修** | `profile.js:36,103-112` |
| M7 选菜弹层无搜索 | ✅ **已修（C25）** | 搜索框做进 `components/dish-picker`，两个入口共享 |
| M8 import 时序 | ✅ **已修（C3）** | `dish-import.js` 的 `ensureExisting` 先等菜单就绪 |
| M9 tabBar 重复 switchTab | ✅ **已修（C21）** | `index.wxml` 补 `data-key`，`onTap` 早退 |
| L1 无 hover-class | 仍然存在 → **C26** | 全仓库 0 处 |
| L2 无无障碍 | 仍然存在 → **C27** | 全仓库 0 处 |
| L3 800ms 跳转 | ✅ **已修（C22）** | 12 处统一引用 `ui.TOAST_DURATION`（1500ms） |
| L4 menu 并发保护 | ✅ **已修** | `menu.js:161-163` |
| L5 星星无 transition | ✅ **已修（C23）** | `review.wxss` 的 `.rv-star` 加 `transition: color` |
| L6 loading 态可随机 | ✅ **已修（C24）** | `onRandom` 挡 loading + `.lucky-off` |
| L7 评价区随轮询重建 | ✅ **已不适用** | review 已不订轮询 |

---

## 建议批次（每批一次提交 + 全量回归）

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 第 1 批 ✅ | C1–C5 | **已完成 2026-10-05**，全量 1676 项断言全绿 |
| 第 2 批 ✅ | C9–C11 + C12 | **已完成 2026-10-05**：token 层 + 空态公共层 + state-block 组件（8 页 20 处），新增 91 项 |
| 第 3 批 ✅ | C6 + C22–C24 + C19–C21 | **已完成 2026-10-05**：搜索防抖 + 7 项体验微调，新增 37 项（含行为测试） |
| 第 4 批 ✅ | C13 + C14 + C25 | **已完成 2026-10-05**：`styles/sheet.wxss` + `utils/dish-search.js` + `components/cart-list` + `components/dish-picker`（含搜索），新增 132 项 |
| 第 5 批 ✅ | C7 + C15–C18 + C26 + C27 + C29 | **已完成 2026-10-05**：`utils/paging.js` 分页 + `constants.STATUS` 状态枚举 + `styles/tap.wxss` 按压反馈 + 并发保护 + id 定位 + 魔法值收口 + 日志时间窗，新增 100 项 |
| 待定 | C8 → 之后是 C28 → 决定 C30 | `C8`（轮询瘦身）可独立做；`C28` 需要拍板 |

> 每批完成后跑：全量 `test_*.js` + `audit_wxml.py` + `audit_pack.py` + `test_style_compat.js`。
