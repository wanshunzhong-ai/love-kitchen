# 爱心小厨房 · 全量审查报告

> 2026-10-05 全量审查（11 个页面 + 19 个 utils + 组件 + 全局样式）。
> 这是**第二版**审查：第一版 `page-optimization-checklist.md`（2026-09-29）的 H1-H7 已实施，本版复核了 M1-M9 / L1-L7 的现状，并补上了当时未覆盖的**架构层**与**逻辑健壮性**两块。
> 每条都带 `文件:行号`，可直接定位。

---

## 一、总体评价

**规模**：11 个页面（页面代码 8538 行）+ 19 个 utils（4849 行）+ 1 个组件 + 2 张云表（`orders` / `dish_logs`）。

### 做得好的地方（这些是底子，别在优化中弄坏）

1. **兼容性约定写在 `app.wxss:1-31` 顶部，且基本被遵守**——全仓库 `gap:` CSS 声明 **0 处**（13 处命中全在注释里）、`font-size` 最小值正好 **22rpx 无违规**、`style="..."` 内联硬编码 **0 处**。约定写成注释并真的执行，这在个人项目里少见。
2. **纯函数抽得干净**：`frequency` / `avoids` / `reject` / `deadline` / `dine` / `review` 全都能被 node 直接加载测试，1460+ 断言。规则「只在一处定义」的原则贯彻得不错（忌口收敛、驳回理由、菜品行唯一键）。
3. **云连接单点**：`utils/cloud.js` 是唯一来源，且**懒加载**——`require` 零副作用，纯本地模块可安全引用云端模块，测试不必装 SDK 桩。
4. **注释解释「为什么」而不是「是什么」**：例如 `live.js:68-70` 解释首轮为什么不能报变化、`menu.js:157-159` 解释 stale-while-revalidate、`order-edit.js:10-11` 解释为什么一页两身份。这是这个项目最值钱的部分。
5. **审计流水的设计很克制**：`dish_logs` 只给 SELECT + INSERT、写入全静默且失败只提示一次、埋点放在 `utils/dishes.js`（所有改动的必经之路）而非页面层。

### 但有三类**系统性债**，不是零散小问题

| 类别 | 本质 | 症状 |
| --- | --- | --- |
| ① 样式缺共享层 | 设计常量（渐变/主色/圆角/阴影）靠复制粘贴传播 | 主渐变手写 **23 次**、`#FF7A9E` **39 次** |
| ② 页面缺组件化 | 只有 1 个组件（`dish-editor`），实践未推广 | `checkout` 与 `order-edit` 有 **26 个同名类整块重复** |
| ③ 数据层全量拉取 | 每次轮询拉最近 200 单全字段，无分页无增量 | payload 随使用时间单调增长 |

---

## 二、布局与视觉一致性

### 2.1 🔴 安全区双写只有 2/14 个文件做到（真机 bug + 违反自家约定）

`app.wxss:13-16` 的约定原文写着「安全区一律『常量兜底 + calc(env())』双写，不写兜底时一旦不认 env() 整条声明会失效（归零）」。实际只有 `dish-import.wxss` 与 `dish-logs.wxss:7-8` 做到了，**其余 12 个文件、14 处**只有 `env()`：

```
pages/orders/orders.wxss:6        padding-bottom: calc(150rpx + env(safe-area-inset-bottom));
pages/todo/todo.wxss:6            同上
pages/menu/menu.wxss:6/337/355/412
pages/checkout/checkout.wxss:6
pages/order-edit/order-edit.wxss:6/548
pages/profile/profile.wxss:10
pages/dish-edit/dish-edit.wxss:6
pages/review/review.wxss:7
components/dish-editor/dish-editor.wxss:23
custom-tab-bar/index.wxss:11
```

后果：低版本 Android 内核上整条 `padding-bottom` 失效 → 底部内容贴安全区、被 tabBar 压住。**这是本次审查里最该先修的一条**（改动量极小：每处补一行 `constant()`）。

### 2.2 🟠 设计常量靠复制粘贴（缺 token 层）

- 主渐变 `linear-gradient(135deg, #FF7A9E, #FF9F43)` —— **23 处**。`app.wxss:37/83/132` 已经有 `.btn-main` / `.btn-retry` / `.dine-chip-on` 承载它，但各页仍手写 20 次。
- 主色 `#FF7A9E` **39 处**、`#FF9F43` **24 处**。
- `border-radius` 共 **116 处**，取值有 `999/50%/32/24/20/18/16/14/12/10rpx` 十档；`box-shadow` 20 处，其中 `0 6rpx 24rpx rgba(255,122,158,0.08)` 在 `app.wxss:32` 与 `menu.wxss:279` 逐字相同。
- Hero 渐变 `linear-gradient(135deg, #FFD3E0, #FFE9C7)` 在 `todo.wxss:11` / `dish-import.wxss:19` / `menu.wxss:13` 三处雷同。

改一处颜色要动二十个文件——这就是「想换配色时不敢动」的根源。

### 2.3 🟠 `.state` / `.btn-retry` 被 todo 页整套覆盖，数值已经漂移

`app.wxss:54-94` 定义了全局三态样式，`todo.wxss:261-294` 又整块重写了一遍，且**已经不一致**：

| 属性 | app.wxss | todo.wxss | 差异 |
| --- | --- | --- | --- |
| `.state` padding | `120rpx 40rpx` | `100rpx 40rpx` | 不同 |
| `.state-emoji` 字号 | `88rpx` | `90rpx` | 不同 |
| `.state-tip` 字号 | 继承 28rpx | `27rpx` | 不同 |
| `.btn-retry` 字号/内边距/行高 | `26rpx / 0 48rpx / 72rpx` | `27rpx / 0 56rpx / 76rpx` | 全不同 |
| `.btn-retry::after { border:none }` | **有**（`app.wxss:92`） | **丢了** | 可能露出原生按钮边框 |

### 2.4 🟠 `.spice-*` 两套皮肤

4 个页面逐字相同（`menu.wxss:206-224`、`order-edit.wxss:150-168`、`orders.wxss:253-271`、`review.wxss:157-175`），但 `todo.wxss:138-152` 是**另一套**：只写 `background` 不写 `color`，且色值全不同（`.spice-0` `#D9C6BF` vs 其余 `#F4EDE9`）。同一个「微辣」在待做页和订单页看起来是两个颜色。

> `review.wxss:147` 的注释自认了这件事：「页面样式按页隔离，所以这里要再写一份」。这个判断对（小程序 wxss 确实按页隔离），但结论应该是「抽到 `app.wxss` 或 `@import` 公共文件」，而不是「再写一份」。

### 2.5 🟡 零按压反馈、零无障碍

- **`hover-class` 使用 0 处**。全项目 89 个 `bindtap`，其中约 69 个落在 `view`/`text` 上（另有 20 个 `<button>` 自带原生按压态）。可点的 `view` 全部没有「按下去」的反馈——`menu.wxml:9/12/13/47/55/98/112/115`、`todo.wxml:71/72/73` 等。
- **`aria-role` / `aria-label` 0 处**。

---

## 三、页面结构：重复与巨石

### 3.1 🔴 `checkout` ↔ `order-edit` 有 26 个同名类整块重复

两个页面都在渲染「购物车行 + 选菜弹层」，样式几乎逐块复制（行号成对）：

```
.section(9/9)  .cart-item(28/31)  .ci-emoji(47/43)  .ci-spice(61/64)  .ci-chip(108/111)
.ci-stepper(147/170)  .step(152/176)  .ci-name(183/207)  .ci-edit(192/216)  .ci-remove(203/227)
.input(226/363)  .textarea(233/370)  .ph(243/380)  .submit(250/512)
.cats/.cat/.cat-active（menu.wxss:141/146/157 ↔ order-edit.wxss:574/579/590）
.mask/.sheet/.sheet-head/.sheet-close（menu.wxss:393+ ↔ order-edit.wxss:529+）
```

`orders.wxss` 与 `todo.wxss` 之间同样有 `.order*` / `.oi-*` 一整组重复。

### 3.2 🟠 三态结构在 6 个页面各写一遍

`orders.wxml:24-39`、`todo.wxml:15-29`、`menu.wxml:65-88`、`review.wxml:26-35`、`dish-edit.wxml:2-12`、`dish-logs.wxml:23-39` —— 几乎同构的 `state-emoji / state-tip / state-sub / btn-retry`，无公共组件。

### 3.3 🟠 `order-edit.js` 是巨石（775 行）

| 函数 | 行数 | 问题 |
| --- | --- | --- |
| `loadOrder` | 75 | 内含 `:192-222` 的 **24 键巨型 setData**（items/avoids/dineDates/dineSlots 全是数组 → 一次整页重画） |
| `onSave` | 64 | 校验 + 拼 payload + 提交 + 跳转揉在一起 |

其余页面最大函数均 ≤60 行（`checkout.onSubmit` 56、`review.submit` 57），说明这是**局部**问题，不是全项目风格。

---

## 四、逻辑与数据流

### 4.1 🟠 轮询订阅的防重入不对称

- `menu.js:86` 有 `if (this._unsub) return` 防重入 ✅
- `orders.js:81`、`todo.js:71` 的 `startLive` **没有** —— 若在无 `stopLive` 的情况下连续调两次，`this.unsub` 被覆盖、旧订阅泄漏。当前 `onShow`→`onHide` 交替下不会触发，但这是靠调用时序兜住的，不是靠代码保证的。
- `menu.js` 只有 `onHide` 退订，没有 `onUnload`（实际安全，因为 onHide 先于 onUnload，但与其他两页不对称）。

### 4.2 🟠 状态枚举靠字面量散布 + `urgency` 用 `else` 兜底

`'pending'` / `'cooking'` / `'done'` / `'rejected'` 作为字符串直接出现在 `orders.js:28-31/144-145/405/409/420/436`、`order-edit.js:64/184-187/582/738`、`todo.js:174` 等十余处。

更值得警惕的是 `live.js:126-129`：

```js
if (s === 'done') done += 1
else if (s === 'cooking') cooking += 1
else if (s === 'rejected') rejected += 1
else pending += 1        // ← 未知状态被静默算进「待开做」
```

用 `else` 兜底而不是白名单，意味着**将来新增任何状态都会被静默计入 pending** → 角标常亮 + 一直 15 秒轮询，且不报错。项目记忆里已经记录过这个坑（「加新状态时最易漏的是 urgency 的计数分支」），但治的是「记得去改」，没治根因。

### 4.3 🟠 静默失败与缺失的错误态

**无 `loadError` 态、失败只能 toast 并返回的页面**：

| 页面 | 现状 | 后果 |
| --- | --- | --- |
| `order-edit.js:223-229` | 加载失败 → toast + 800ms 后 `navigateBack` | 用户没有重试入口，只能再点一次进来 |
| `checkout` / `dish-import` | data 里无 loading/loadError | — |

**静默失败**（只 `console`，不告知用户）：

- `dish-import.js:64` `loadExisting` 失败静默 `existing = []` → **直接导致 M8**：菜单没拉回来时，解析会把所有同名菜判成「新增」，把「更新」误报为「新增」，用户看到错的预览还得自己发现。
- `pages/orders/orders.js:478` `.catch(function () {})` —— 空 catch，在「删单撤销窗口内提前真删」分支上，失败无任何提示（数据可能没删掉但界面已移除）。
- `menu.js:113` 频率加载失败静默（**这是有意的**，注释说明「失败就按原顺序」，合理）。

### 4.4 🟡 竞态与并发保护缺口

**已有保护**：`menu.js:162`（`_loadingDishes`）、`dish-logs.js:46`（`_loading`）、`live.js:435`（`busy`），以及各保存动作的 `saving`/`submitting` 标志。

**缺口**：

- `review.js:79 loadOrder` 被 `onLoad` / `onRetry` / `onPullDownRefresh` 三处调用，**无 in-flight 标志** → 重试与下拉可并发两次 `getOrder`。
- `orders.js:228 updateStatus` / `:372 updateStatusByOrder` 无 per-row 防重复点击标志，仅靠 `ui.showLoading` 遮罩，快速双击理论上可发两次。
- `orders.js:226-229` 用**下标**取目标单（`this.data.filteredOrders[idx]`），await 期间若轮询全量重画 `orders`，下标会错位——注释自己承认了「筛选后索引会与 orders 对不上，改错单」。虽然按 `id` 匹配兜了一道，但源头是指标定位。

### 4.5 🟡 魔法数字与硬编码

| 常量 | 出现次数 | 位置 |
| --- | --- | --- |
| `setTimeout(..., 800)` | **13** | order-edit×7、dish-edit×3、review×2、checkout×1 |
| `setTimeout(..., 6000)`（提示条） | 2 | `orders.js:178`、`todo.js:141` |
| `setTimeout(..., 5000)`（撤销窗口） | 1 | `orders.js:496` |
| `confirmColor: '#FF7A9E'` | 7 | order-edit×2、orders×3、todo、review |
| 兜底署名 `'宝贝'` | 4 | checkout、order-edit×2、review |
| 辣度默认 `'不辣'` | 9+ | 散落多处（`constants.SPICE_LEVELS` 已存在） |
| 状态字面量 | 15+ | 见 4.2 |

`dish-import.js:169-170` 更典型：阈值 `200000` 与文案「一次别超过 20 万字符」两处硬编码，改一处必漏另一处。

### 4.6 🟠 数据层：每 15 秒拉 200 单全字段，无分页无增量

`listOrders` 取最近 200 单，每单含 `items`（jsonb）+ `avoids`（jsonb）+ `reviews`（jsonb）。轮询在「有待开做」时是 **15 秒一轮**（`live.js:28-33`）。而 `frequency.js` 的统计范围也复用这 200 单。

两个后果：

1. **payload 随使用时间单调增长**——用得越久越慢，没有「只拉最近 N 天」或增量拉取。
2. **频率统计的上限被数据层绑死**——某道菜掉出最近 200 单就不再计入，掌勺人的「常点」榜会「遗忘」老菜（这是设计取舍，但值得写进注释）。

---

## 五、体验细节（上一版清单的遗留项，复核后仍存在）

| 编号 | 位置 | 问题 | 改动量 |
| --- | --- | --- | --- |
| M1 | `menu.js:196-199` | 搜索无防抖、无历史：每字符全量过滤 303 道 + 整列表 setData（叠加频率排序时每字符还要 sort 一次） | 小 |
| M2 | `menu.wxml:96`、`order-edit.wxml:261`、`dish-editor.wxml:80` | 303 道菜全量渲染，无分页/虚拟列表 | 中 |
| M3 | `menu.js:347,352` | 「今天吃什么」从**全部** dishes 随机，忽略当前分类/搜索 | 小 |
| M5 | `dish-edit.json:2` | 编辑已有菜时导航栏仍叫「加菜」（`order-edit.js:122` 有 `setNavigationBarTitle` 的正面示范） | 小 |
| M7 | `order-edit.wxml:240-275`、`dish-editor.wxml:65-94` | 两处选菜弹层只有分类筛选，无搜索框 | 中 |
| M8 | `dish-import.js:52-69,183` | `loadExisting` 未被 await，解析可能用空的 existing → 同名菜误判为「新增」 | 小 |
| M9 | `custom-tab-bar/index.js:81-85` | 点已选 tab 仍发 `switchTab`，无 `selected === key` 早退 | 小 |
| L1 | 全部 wxml | `hover-class` 0 处 | 小 |
| L2 | 全部 wxml | 无 `aria-*` | 小 |
| L3 | `checkout.js:356-360` | 成功后 800ms 就 `switchTab`，1500ms 的 toast 看不完 | 小 |
| L5 | `review.wxss:190-200` | 打星无 `transition`，变色瞬切 | 小 |
| L6 | `menu.wxml:112` | `loading` 态下「🎲 今天吃什么」仍可点，且基于旧 `dishes` | 小 |

**上一版已修**：M6（profile 改 dirty 标记 + 显式保存）、L4（`menu.js:161` 并发保护）、L7（review 已不订轮询，源头消失）。
**部分修**：M4（辣度的**色值**已在 4 页统一，但**重复**未收敛，且 `todo` 页仍是另一套）。

---

## 六、架构层：最值得想清楚的一件事

### 6.1 🔴 菜单「本地优先」导致两人手机上的菜单可能不一致

**事实**：303 道菜内置在 `data/dishes.js`，用户改动写在各自手机的 storage（`dishes_override_v1` / `dishes_deleted_v1`），**不上云**。订单与忌口上云，菜单不上云。

**后果**：

- 干饭人在菜单页加了一道菜、改了菜名、下架了一道菜——**掌勺人的手机不会变，也收不到**。
- 这次做的「菜单日志」让掌勺人**看得见**「TA 干过什么」，但不能**对齐**——看完日志，掌勺人手机上的菜单依然是旧的。
- 菜单页对两种身份都开放维护入口（`menu.wxml` 的「＋ 加菜」/「📥 批量」），但两边维护的是**两份互不相干的清单**。这意味着「我加了一道菜」和「你能点到这道菜」之间没有因果关系。

这是当前架构里**最大的产品缺口**，而且它会**放大**其他问题（两边菜单不同 → 日志越重要 → 云表越不可省 → 数据层越重）。

**这不是「优化」，是产品决策**，需要在两条路里选：

| 方案 | 代价 | 收益 |
| --- | --- | --- |
| A. 菜单保持本地 | 0 | 各自为政，永远对不齐 |
| B. 菜单上云共享（含双向同步、冲突处理） | 大（要新建 dishes 表、改写 `utils/dishes.js` 的本地优先策略、处理离线编辑） | 终结「菜单不一致」，日志退化为审计而非补偿手段 |

> 顺带：云上已经有张 `dishes` 表（101 行），是早期「菜单放云端」方案的残骸，当前代码零引用。如果决定走 B，它是起点；如果不走，建议清掉以免误解。

### 6.2 数据表的增长无边界

`dish_logs` 只增不减（append-only 是对的，但**没有归档/清理策略**），页面按天分组全量拉。用得久了日志页会越来越慢。建议至少加「只查最近 N 天」或分页。

---

## 七、建议执行顺序

### P0 · 真机可见的隐患（改动量小，收益直接）

1. **安全区补 `constant()` 兜底**：12 个文件 14 处（§2.1）——违反自家约定、低端安卓上真出 bug。
2. **`order-edit` 补 `loadError` 错误态**（§4.3）——失败别把用户直接踢回上一页。
3. **`dish-import.loadExisting` 等就绪再解析**（M8）——现在会给出错的预览。
4. **`urgency` 改白名单**（§4.2）——消掉「未来新增状态静默算进 pending」的定时炸弹。

### P1 · 性能（用得越久越明显）

5. **搜索防抖 200ms**（M1）+ 把排序从「每次输入都 sort」改为「filter 后按需排」。
6. **长列表分页**（M2）：菜单页 / 选菜弹层 / dish-editor 三处共用一套「滚动到底 +30」。
7. **轮询瘦身**：评估「只拉最近 N 天」或字段裁剪（§4.6）。

### P2 · 一致性（把复制粘贴收敛掉）

8. **新增 `styles/common.wxss`（`@import`）承载设计 token**：主渐变、主色、圆角、阴影各定义一次（§2.2）。这一步做完，第 9、10 条才有落点。
9. **删除 `todo.wxss:261-294` 的本地重写**，改用全局 `.state`/`.btn-retry`；把 `todo` 的辣度皮肤并入统一的那套（§2.3、§2.4）。
10. **抽三个组件**：`state-block`（三态，6 页复用）、`cart-list`（`checkout`/`order-edit` 复用）、`dish-picker`（选菜弹层，3 处复用）——**先抽 `state-block`**，性价比最高（§3.1、§3.2）。

### P3 · 健壮性

11. **状态枚举收进 `constants.js`**（如 `ORDER_STATUS_KEYS`），替掉十余处字面量（§4.2）。
12. **补齐并发保护**：`orders`/`todo` 的 `startLive` 防重入、`review.loadOrder` 的 in-flight（§4.1、§4.4）。
13. **魔法数字收口**：`800/5000/6000`、`confirmColor`、`'宝贝'`、`'不辣'` 提到 `constants.js`（§4.5）。

### P4 · 体验微调（一次批量做掉）

14. M3 随机尊重当前筛选、M5 改菜标题、M9 tab 早退、L3 跳转延到 1500ms、L5 补 `transition`、L6 loading 态禁用随机。
15. **全局按压反馈**：在 `app.wxss` 定义 `.tap-hover { opacity: .7; transform: scale(.98) }`，批量给可点 `view` 加 `hover-class="tap-hover"`（L1）。顺手补关键入口的 `aria-label`（L2）。

### P5 · 架构议题（需你拍板，不宜顺手做）

16. **菜单是否上云共享**（§6.1）——这是最有价值也最贵的一条，建议单独规划。

---

## 八、附：上一版清单复核结果一览

| 项 | 结论 | 证据 |
| --- | --- | --- |
| M1 搜索无防抖 | 仍然存在 | `menu.js:196-199` |
| M2 长列表无分页 | 仍然存在 | `menu.wxml:96` 等 3 处 |
| M3 随机忽略筛选 | 仍然存在 | `menu.js:347,352` |
| M4 视觉不一致 | **部分修** | 色值已统一，重复未收敛，todo 仍两套 |
| M5 dish-edit 标题 | 仍然存在 | `dish-edit.json:2` |
| M6 profile toast 过频 | **已修** | `profile.js:36,103-112` |
| M7 选菜弹层无搜索 | 仍然存在 | `order-edit.wxml:240-275` |
| M8 import 时序 | 仍然存在 | `dish-import.js:52-69,183` |
| M9 tabBar 重复 switchTab | 仍然存在 | `custom-tab-bar/index.js:81-85` |
| L1 无 hover-class | 仍然存在 | 全仓库 0 处 |
| L2 无无障碍 | 仍然存在 | 全仓库 0 处 |
| L3 800ms 跳转 | 仍然存在 | `checkout.js:356-360` |
| L4 menu 并发保护 | **已修** | `menu.js:161-163` |
| L5 星星无 transition | 仍然存在 | `review.wxss:190-200` |
| L6 loading 态可随机 | 仍然存在 | `menu.wxml:112` |
| L7 评价区随轮询重建 | **已不适用** | review 已不订轮询 |

**本版新增（一版未覆盖）**：§2.1 安全区、§2.5 按压反馈量化、§3 组件化、§4 逻辑健壮性（防重入/`else` 兜底/静默失败/竞态/魔法数字）、§4.6 数据层、§6 架构层。
