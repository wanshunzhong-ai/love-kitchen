# 数据层设计（菜品 / 订单 / 菜单日志）

本文是数据层的完整说明：每层的来源、合并规则、写路径、以及「为什么这么做」。
`MEMORY.md` 只留摘要与指针；改数据层前先读本文。

- AppID `wx5d9f3fcfada93f13`；云应用 ID `wbapp_Q7J8UvVewXzjOG0IpQ4004`（`.workbuddy/applications.yaml`）
- 三条数据通道：**菜品**（本地为主 + 共享增量）、**订单**（云 PostgreSQL `public.orders`）、**菜单日志**（云 `public.dish_logs`）

---

## 一、菜品库：本地优先 + 一条单向共享链（C28 / C30）

### 分层

| 层 | 位置 | 说明 |
| --- | --- | --- |
| seed | `data/dishes.js` | 内置 **303 道**，id `1..303`，由 `scripts/merge-template-dishes.js` 生成，**勿手工编辑** |
| override | 本地 storage `dishes_override_v1` | 应用内新增 / 编辑的菜，按 id 覆盖 seed |
| deletedIds | 本地 storage `dishes_deleted_v1` | 删掉的 seed 菜 id 黑名单（否则刷新后 seed 会让它「复活」） |
| shared | 云表 `public.dishes` | **只放掌勺人新增的菜**（共享增量层） |

### 为什么只同步一条单向链

内置 303 道**两台手机本来就有同一份**（都在代码里），不需要同步。
所以「菜单对不齐」只发生在**应用内加的菜**上，而且两条链**根本不对称**：

| 方向 | 现状 |
| --- | --- |
| 干饭人加菜 → 掌勺人 | **本来就通** —— 下单时 `orders.items` 是快照，菜名跟单过去；另有 `dish_logs` |
| 掌勺人加菜 → 干饭人 | **原先完全不通** —— 干饭人点单页读的是自己手机的菜单，看不到、点不到 |

C28 只补后一条：**只加不减、没有改名、没有下架 → 不需要冲突处理**，成本约为完整双向同步的 1/4。
「干饭人加的菜只留本机」是刻意的 —— 下单时菜名进 `orders.items` 快照，掌勺人看得到。

### id 双号段（「不撞号」的唯一保证）

- 分界：`constants.CLOUD_ID_BASE = 100001`
- `< 100001` **本地号段**：内置 seed + 本机加的菜，**两台手机各自发号**
- `≥ 100001` **云端号段**：云表 identity 发号，两台手机同一个 id
- 本地自增在两台手机上从**同一个数**起步（都从 seed 长度往后排）→ **把本地 id 当云端 id 用必然撞号**
- 因此 **`nextId()` 与 `importDishes` 的 cursor 都必须显式跳过云端号段**

### 写路径：先本地落盘 + 事后 rekey

```
掌勺人新增
  → 本地落盘（本地号段 id + pendingSync 标记）：立刻成功、离线可用、**不 await**
  → 推上云 pushAdd → 拿到云端 id
  → rekey：把本地那一行换成云端 id 并清掉 pendingSync
  → 推失败：静默留着标记，下次 sync() 补推
```

### 合并规则（唯一实现 `utils/dish-cloud.js::mergeInto`，纯函数）

按序三条：

1. 本地拉黑过 → **跳过**（不复活）
2. 本地 `localEdited` → **不覆盖**（本地优先）
3. 否则：没有就插入、有就按云端更新

- 内置菜的 id **永不在云端表里** → 这条链**碰不到内置菜**
- **「内容一样」不算更新**（否则每次 `onShow` 都白重画一遍列表）
- `dish-cloud.js` 的网络函数**失败一律静默**（返回 `null` / `false`，从不抛错）——
  菜单是本地功能，云端挂了必须还能读、还能改内置菜

### 接线点

菜单页 `onShow` 调 `syncShared()`，**必须放在 `loadDishes()` 之后**（别让网络挡住首屏），
只有 `added` / `updated` 非零才重画。

### 云表 `public.dishes` 结构约定

- 是 **identity 列且从 100001 起**（C30 改造时 `RESTART WITH 100001`）
- 有 `by_name`（谁加的，快照）与 `updated_at`
- RLS 策略 `dishes_couple_all` + `anon` / `authenticated` 的 ALL GRANT 都在
- 内置 303 道**不进表**
- 导入上限 `csv.IMPORT_MAX = 500`（曾 300，菜单超 300 后导回会被截断）

---

## 二、订单：云 PostgreSQL + 增量轮询（C8）

订单表 RLS 是「两人共享一份」，**服务端拿不到身份**（见 `MEMORY.md` 的权限边界表）。

### 查询有两条路

- **全量 `listOrders`**：`select('*')` + `order('created_at', DESC)` + `range(0, 199)`（上限 `MAX_ORDERS = 200`）
- **增量两步**（`utils/order-sync.js`）：
  1. `listOrderHeads`：只 `select('id,status,updated_at')` —— **三列标量，一个 jsonb 都不带**
  2. `listOrdersByIds`：`in('id', ids)` **一条请求批量**，只为「新的 / 变了的」发

### 核心事实：`updated_at` 是「这条动过没」的唯一信号

`utils/orders.js` 每条写路径都写它：

| 操作 | 是否写 `updated_at` |
| --- | --- |
| `updateOrder`（改内容） | 显式写 |
| `updateOrderStatus`（推进状态） | 显式写 |
| `rejectOrder` / `withdrawReject`（驳回 / 收回） | 显式写 |
| `saveReview`（评价） | 显式写 |
| `createOrder`（新增） | 走列的 `DEFAULT now()` |
| 删除 | 不写 —— 靠「头列表里消失」发现 |

### 三条不可动摇的约束

1. **等价不变式**：增量拼出来的 `orders` 必须与全量 `listOrders` **逐字节一致**
   （顺序 = 头顺序 = `created_at DESC`、上限同 200）。
   守住它 → `live.js` 的 watcher / `snapshot` / `diff` / 页面层**零改动**。
2. **失败不推进基准**：详情批失败就抛给轮询退避（基准不动）；某条少返回就**保持旧值**
   且不记进基准 → 下轮重试。否则那次更新**永久丢了且不报错**。
3. **`headsUsable()`**：轻量头没带回 `updated_at`（全是 0）→ **退回全量**。
   否则增量会永远认为「没变化」，页面**静默失去实时性**（不报错，最难查）。

改 `listOrderHeads` 的列名之前，先读它上面的注释块。

### 为什么不用「时间窗」或「砍字段」

- **时间窗**会让订单页老订单凭空消失（要么伤功能，要么再加一套「加载更早」），
  而且**并不降低单条订单的大小**。
- **字段裁不掉**：订单页要 `review.decorateItems(o.items, reviews)`、待做卡片要菜名、
  `frequency.js` 靠 `items` 数频率、`deadline.js` 要数份数；`frequency.js` 还依赖「最近 200 单」这个范围。
- 病根不在字段多，在于**每轮重拉那些根本没变的**。

### 入参校验：不能只判 `isNaN`

`Number('')` 与 `Number(null)` 是 **0**、`Number(true)` 是 **1** ——
只判 `isNaN` 会让空值变成 `in.(…,0)`、布尔垃圾查成一条真订单。
正解：先要求 `typeof` 是 string / number，再要求**正整数**（订单 id 是 bigint identity，从 1 起）。

### 快照语义

- `orders.items` / `orders.avoids` 都是**下单那刻冻结的快照**，事后改不倒推
- 同一道菜**不同辣度算两条独立记录**
- **掌勺人的手机读不到干饭人的本地存储** → 任何「干饭人的本地数据要给掌勺人看」的需求都必须写进订单上云
- 忌口收敛（trim / 去重 / 单条 10 字 / 最多 12 条）唯一实现在 `utils/avoids.js`
- **`pages/order-edit` 一张页面两种身份读两个来源**（易踩）：掌勺人读 `order.avoids`（订单快照），
  干饭人读 `store.getAvoids()`（自己当前清单，所见即所提交）。合并成一处必坏一头。

---

## 三、菜单日志 `dish_logs`：跨设备留痕

- **append-only 审计表，只给 SELECT + INSERT**（无 UPDATE / DELETE 权限）
- 为什么需要：菜品库本地优先 → **干饭人改菜单掌勺人收不到**，只能靠这张表传
- `dish_name` / `by_name` / 变更字段名都存**快照**（中文「辣度」而不是键 `spice`）——
  否则以后改了枚举名，历史日志会全部读不懂
- **默认 30 天时间窗 + 200 条上限**：`.gte('created_at', since)` **让时间窗在服务端生效**
  （不是拉全再本地裁）；「看更早的 ›」按 **×3** 扩窗（30 → 90 → 270 → 封顶 365 天）
- 点了保存但什么都没改 → **不记日志**（否则真正要紧的改动被淹掉）

---

## 四、云连接与迁移

- **唯一来源 `utils/cloud.js`**（`PUBLIC_CONFIG` / `getCloud` / `getDB` / `unwrap`）：
  订单与菜单日志共用一个客户端；**SDK 懒加载** → `require('./cloud')` 零副作用，
  纯本地模块可放心引用（单测不必装 SDK 桩）
- 云服务 SDK 只有 `database / auth / storage / llm`：**没有 realtime、没有长连接、没有推送**
  → 「实时」只能靠前台轮询（`utils/live.js` + `utils/order-sync.js`）
- 加订单字段的流程：写 `cloudbase/migrations/*.sql` → MCP
  `workbuddy_cloudservice_db_exec_sql`（`mode=migrate`）执行 → `describe_table` 复核。
  **列级权限继承表级 GRANT，新增列不用再 GRANT**
