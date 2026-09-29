# 页面层优化清单

> 2026-09-29 全页面审查产出（pages/ 全部 9 页 + custom-tab-bar + app.js/app.wxss + utils/ui.js、live.js、store.js、components/dish-editor）。
> 本清单只存档，未实施。将来动手时从「四、优先顺序」开始。

---

## 一、高价值（用户能直接感知）

### H1. 菜单页每次 onShow 全量重载，闪 loading + 丢失滚动位置
- 位置：`pages/menu/menu.js:66-90`（loadDishes 设 `loading:true`）、`menu.js:51`（onShow 每次调用）、`menu.wxml:46-49`
- 现状：从 dish-edit 改完菜返回、从 checkout 返回、每次切 tab 回来，303 道菜的列表先被「正在摆盘…」占位替换、再整列表 setData 重画；滚动位置随之丢失回到顶部。下拉刷新（menu.js:254-258）同样会闪。
- 建议：`dishes.length` 非空时不置 loading（stale-while-revalidate：先渲染旧列表，请求回来静默 setData）。
- 改动量：小-中

### H2. 冷启动每次都强制走身份选择页
- 位置：`app.json:3`（首页是 role-select）；`pages/role-select/role-select.js:16-38`
- 现状：已选过身份的老用户每次冷启动都要手动点一次卡片才能进功能页。
- 建议：已有身份时顶部加「继续作为 {身份} 进入 →」主按钮（或 800ms 自动 reLaunch），点其它卡片仍可换身份。
- 改动量：小

### H3. 轮询每轮全量重渲染 orders/todo 列表（无视 diff）
- 位置：`pages/orders/orders.js:78-92 + 123-159`；`pages/todo/todo.js:71-81 + 112-127`
- 现状：live.js 已算好差异（`d.any`，15/30/60s 三档轮询），但页面每轮整列表 setData。订单多时每 15s 一次大树 diff，读评价时内容重排，白耗电。
- 建议：订阅回调里 `if (d && d.primed && !d.any) return`（首帧与真变化才 render）；进阶可按订单 id 做路径级 setData。
- 改动量：小

### H4. 购物车数量减到 1 再点「−」静默删行；删除类操作全无撤销
- 位置：`pages/checkout/checkout.wxml:56-60`、`checkout.js:112-125`（`utils/store.js:122-140` qty≤0 直接移除）；删单 `pages/orders/orders.js:417-466`、下架菜 `pages/dish-edit/dish-edit.js:108-134` 只有确认无撤销
- 现状：qty=1 时点「−」菜直接消失，无提示无恢复；删单/下架文案明说「找不回来了」。
- 建议：① stepper qty=1 时「−」置灰或点它弹确认；② 删单改「先本地移除 + toast『已删除 · 撤销』，5 秒后真正调 deleteOrder」；至少给 checkout 的 ✕ 加确认。
- 改动量：小（①）/中（②）

### H5. 全局零触感反馈（haptic）
- 位置：全仓库无 `vibrateShort`。涉及加购 `menu.js:191`、推进状态 `orders.js:217` / `todo.js:162`、下单 `checkout.js:234`、打星 `review.js:144`
- 建议：`utils/ui.js` 加 `haptic(type)` 封装（wx.vibrateShort，light/heavy，失败静默），关键确认操作各加一行。
- 改动量：小

### H6. review 页错误态没有重试按钮；dish-edit 加载失败直接被踢回
- 位置：`pages/review/review.wxml:31-35`（只有文案「下拉刷新即可」，json 已开下拉但用户不知道）；`pages/dish-edit/dish-edit.js:48-54`（失败 toast 后 800ms navigateBack）
- 建议：review 补 `btn-retry`（复用 app.wxss 的 .state/.btn-retry）；dish-edit 改页内错误态+重试。
- 改动量：小

### H7. 断网无全局感知
- 位置：全仓库无 `onNetworkStatusChange`，失败全靠点按钮后的 toast「网络开小差了」。
- 建议：app.js onLaunch 监听，断网时全局提示。
- 改动量：小

## 二、中价值

- **M1** 搜索无防抖无历史：`pages/menu/menu.js:93-96` 每字符全量过滤 303 道 + 整列表 setData。建议防抖 200ms + 搜索历史（storage 最近 5 条）。小-中
- **M2** 长列表无分页：`menu.wxml:77`、`order-edit.wxml:240-255`、`components/dish-editor/dish-editor.js:136-146` 均全量渲染 303 道。建议滚动到底 +30 分页，三处共用。中
- **M3** 「今天吃什么」随机忽略当前筛选：`menu.js:232-252` 从全部 dishes 随机，与上下文无关。建议优先 filteredDishes，为空回退全部。小
- **M4** 视觉不一致：辣度标签两套皮肤（`todo.wxss:138-152` 实底白字 vs `menu/orders/review` 浅底深字）；`todo.wxss:261-294` 重写 .state/.btn-retry 与 `app.wxss:54-94` 数值不同；主渐变 `linear-gradient(135deg,#FF7A9E,#FF9F43)` 在 9 个 wxss 重复约 15 次。建议收进 app.wxss（或 common.wxss @import）。中
- **M5** dish-edit 编辑已有菜时导航栏仍叫「加菜」：`dish-edit.json:2` 固定。建议带 id 时 `setNavigationBarTitle('改菜')`（`order-edit.js:122` 是正面示范）。小
- **M6** profile toast 过频：`profile.wxml:27、100` 每次失焦弹「已保存」；`profile.js:126-132` 每点状态都 toast。按已有 dirty/introDirty 标记过滤。小
- **M7** order-edit / dish-editor 选菜弹层无搜索框（只有分类筛选）。可复用 menu 搜索实现。中
- **M8** dish-import `loadExisting`（:52-69）静默拉菜单，未返回时解析会把同名菜全判成「新增」。解析前先等 existing 到位。小
- **M9** tabBar 点已选 tab 也发 switchTab：`custom-tab-bar/index.js:81-85`。加 `selected === key` 早退。小

## 三、低价值

- **L1** 可点 view 无 `hover-class` 按压态（全仓库未用），真机点击缺「按下去」反馈。横向小改。
- **L2** 无障碍：可点 view 无 `aria-role="button"` / `aria-label`。小。
- **L3** checkout 成功后 800ms 就 switchTab（`checkout.js:273-275`），1500ms 的 toast 看不完。小。
- **L4** menu loadDishes 无并发保护（onShow + 下拉可能同时两次请求）。加 `_loading` 标记。小。
- **L5** review 打星无 transition（`review.wxss:190-200`），变亮瞬间跳变。小。
- **L6** menu loading 态下「🎲 今天吃什么」仍显示且基于旧数据（`menu.wxml:91`）。小。
- **L7** 评价区随轮询整列表 setData 重建（H3 修掉后自然缓解），无需单独处理。

## 四、将来实施的优先顺序（前 5 项）

1. **H1** 菜单缓存 + 静默刷新（高频路径、保滚动位置）
2. **H2** 冷启动已选身份一键继续
3. **H3** 轮询无变化跳过 render（砍掉约 90% 无效 setData）
4. **H4+H5** 防误删（stepper 底线、删单撤销）+ ui.js haptic 接入关键操作
5. **H6+H7** 错误兜底（review 重试、dish-edit 不踢回、全局断网监听）

## 五、将来会涉及的文件

pages/menu/*、pages/orders/orders.js、pages/todo/todo.js、pages/checkout/*、pages/review/*、pages/dish-edit/*、pages/role-select/*、pages/profile/*、pages/dish-import/dish-import.js、custom-tab-bar/index.js、app.js、app.wxss、utils/ui.js、components/dish-editor/*
