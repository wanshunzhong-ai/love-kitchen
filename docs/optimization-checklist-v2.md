# 优化清单 v2 · 可执行版

> 来源：`docs/full-review-2026-10-05.md`（全量审查第二版）。
> v1 清单（`page-optimization-checklist.md`）的 H1-H7 已实施；本清单**取代 v1 的第二、三节**，并补上审查新发现的**布局一致性 / 逻辑健壮性 / 架构层**三块。
> 共 **30 条**，按 `P0 → P5` 排序。每条可直接引用编号（例：「做 C1-C5」）。

**进度**：`16 / 30`　🔴 高优先 `5 → 0`　🟠 中 `8`　🟡 低 `3`　⚪ 待拍板 `3`

> **第 1 批（C1–C5）已于 2026-10-05 实施完成**，全量 1676 项断言全绿。
> **第 2 批（C9–C11 + C12）已于 2026-10-05 实施完成**：新增 `styles/common.wxss`（token）+ `styles/state.wxss`（空态）两个公共层与 `components/state-block` 组件，新增 `test_batch2.js` 91 项，全量断言全绿。
> **第 3 批（C6 + C19–C24）已于 2026-10-05 实施完成**：搜索防抖 / 随机尊重筛选 / 改菜标题 / tabBar 早退 / toast 延时唯一来源 / 打星过渡 / loading 禁用，新增 `test_batch3.js` 37 项（含行为测试），全量断言全绿。

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
| M1 搜索无防抖 | ✅ **已修（C6）** | `menu.js` 的 `scheduleFilter` / `cancelSearchDebounce` |
| M2 长列表无分页 | 仍然存在 → **C7** | `menu.wxml:96` 等 3 处 |
| M3 随机忽略筛选 | ✅ **已修（C19）** | `menu.js` 的 `onRandom` 优先取 `filteredDishes` |
| M4 视觉不一致 | ✅ **已修（C9/C10/C11）** | token 收敛、辣度皮肤合一、todo 本地重写删除 |
| M5 dish-edit 标题 | ✅ **已修（C20）** | `dish-edit.js` 的 `onLoad` 带 id 时设「改菜」 |
| M6 profile toast 过频 | ✅ **已修** | `profile.js:36,103-112` |
| M7 选菜弹层无搜索 | 仍然存在 → **C25** | `order-edit.wxml:240-275` |
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
| 第 4 批 | C13 + C14 + C25 | 组件化三件套（cart-list / dish-picker + 搜索） |
| 第 5 批 | C7 + C15–C18 + C26 + C27 + C29 | 分页、健壮性与无障碍收尾 |
| 待定 | C28 → 决定 C30 | 需要拍板 |

> 每批完成后跑：全量 `test_*.js` + `audit_wxml.py` + `audit_pack.py` + `test_style_compat.js`。
