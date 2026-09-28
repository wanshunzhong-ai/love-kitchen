# 🍳 爱心小厨房 Love Kitchen

一个**两人共用**的点菜微信小程序：翻菜单、加点想吃的、备注辣度忌口，大厨在订单页看着进度做菜。适合情侣 / 家人搭伙做饭，也适合作为「微信小程序 + 云数据库」的入门学习项目。

## ✨ 功能特性

- 🔍 **搜索找菜**：支持菜名、食材、分类模糊搜索；多关键词用空格分隔（如「鸡 汤」）；可与分类筛选叠加
- 📖 **菜单分类浏览**：经典热菜 / 凉菜腌腊 / 汤羹煲 / 小吃点心 / 米粉主食（已预置 101 道江西特色菜，**内置在代码里，零配置即可用**）
- 🌶️ **每道菜单独选辣度**：点「＋」时选（默认就是推荐辣度），同一道菜可以点两种辣度分开算（你微辣、他特辣）
- 🛒 **购物车下单**：数量加减、逐道改辣度、一键下单、点菜人署名
- 💬 **订单备注**：辣度、忌口、想说的小留言
- 👩‍🍳 **订单状态跟踪**：待开做 → 开做中 → 已上菜，双方都能推进状态
- ✏️ **订单随时可改**：改菜、改辣度、加减数量、改备注、改点菜人、改状态，或整单删掉
- 🎲 **今天吃什么**：选择困难症一键随机推荐
- ➕ **自助维护菜单**：直接在小程序里加菜、改菜、下架

## 🛠 技术栈

| 层    | 技术                                              |
| ---- | ----------------------------------------------- |
| 前端   | 微信原生小程序（WXML / WXSS / JS），零框架、业务代码零第三方依赖       |
| 菜单数据 | **内置在代码里**（`data/dishes.js`，101 道菜），**零后台配置即可用**   |
| 订单存储 | CloudBase **PostgreSQL**（关系型数据库）                |
| 订单访问 | **小程序直连数据库**（`@cloudbase/wx-cloud-client-sdk`，微信身份鉴权） |
| 权限控制 | 表级 `GRANT` + 行级 `RLS 策略`（见 `cloudbase/migrations/`） |

> **为什么菜单要内置、订单才进数据库？**
> 菜单是静态数据（101 道菜，一年也改不了几次），内置进代码最快：零后台配置、离线可用、读取零延迟。
> 订单必须两个人共享，所以要进真数据库。至于为什么是「小程序直连」而不是「云函数中转」，见下方说明。

### 为什么订单不用云函数？

早期版本订单走云函数（`wx.cloud.callFunction`），后来改成了小程序直连。原因是一个很硬的限制：

- 云函数的运行环境**不注入微信用户身份（JWT）**，它访问数据库时只能以「匿名」身份进行；
- 而匿名身份在 PG 上默认只有读取权限，写入会直接报 `permission denied for table orders`；
- 想让云函数以管理员身份写库，得额外配置数据库 API Key —— 这一步对个人项目来说既麻烦又容易配错。

而**小程序端天然带着用户微信身份**。配上 RLS 策略后，已登录的微信用户即可安全读写订单，**不需要维护任何服务端密钥**。这是官方为小程序直连场景设计的路径，也正好符合「两个人共享同一份订单」的需求。

## 📂 项目结构

```
love-kitchen/
├── app.js / app.json / app.wxss     # 应用入口（含 wx.cloud.init 容错）、tabBar 与全局样式
├── data/
│   └── dishes.js                    # 内置的 101 道菜（id 为纯数字，供本地服务读取）
├── cloudbase/
│   └── migrations/                  # 数据库结构变更脚本（按时间戳顺序）
│       ├── 20260928140000_create_orders.sql   # 建 orders 表 + 索引 + 约束
│       └── 20260928150000_orders_rls.sql      # 配 GRANT + RLS 策略
├── pages/
│   ├── menu/        # 点菜页：分类、购物车、随机帮选
│   ├── checkout/    # 确认订单：数量、备注、点菜人
│   ├── orders/      # 订单页：状态跟踪与推进
│   ├── order-edit/  # 编辑订单：改菜 / 备注 / 点菜人 / 状态 / 删除
│   └── dish-edit/   # 加菜 / 编辑 / 下架
├── utils/
│   ├── api.js       # 数据唯一出口：菜品走本地、订单走 PG
│   ├── dishes.js    # 本地菜品服务（内置数据 + 用户改动的本地覆盖层）
│   ├── orders.js    # 订单服务：小程序直连 PostgreSQL
│   ├── constants.js # 分类 / 辣度 / 订单状态常量
│   ├── store.js     # 购物车与昵称（本地存储）
│   └── format.js    # 时间格式化
├── package.json                     # 声明 @cloudbase/wx-cloud-client-sdk 依赖
└── project.config.json
```

## 🚀 快速开始

### 1. 克隆并导入

```bash
git clone https://github.com/wanshunzhong-ai/love-kitchen.git
```

打开「微信开发者工具」→ 导入项目 → 选择仓库目录。AppID 填你自己的小程序 AppID（仓库中的 AppID 可直接替换）。

### 2. 直接编译，就能看到 101 道菜 ✅

**这一步不需要任何后台配置。** 菜单数据已内置在 `data/dishes.js`，点「编译」即可浏览菜单、加购物车。按「预览」扫码，手机也能看。

订单功能依赖的 SDK（`@cloudbase/wx-cloud-client-sdk`）**已构建好放在仓库的 `miniprogram_npm/` 目录**，克隆下来即可用，**不需要执行 npm install / 构建 npm**。

> 只有当你升级了 SDK 版本（改 `package.json` 后 `npm install`）才需要「工具 → 构建 npm」重新生成；
> 若小程序报「暂不支持 npm 模块」，先重新编译，仍报错再检查 `miniprogram_npm/` 目录是否存在。

### 3. 建数据库表（订单功能需要，换环境才要做）

`cloudbase/migrations/` 下的两个 SQL 脚本已经在当前环境执行完毕。**如果你换了自己的云环境**，需要按顺序执行它们：

1. 打开开发者工具 → 顶部「云开发」→ 控制台；
2. 左侧「数据库」→ 选择 **PostgreSQL**；
3. 依次执行 `20260928140000_create_orders.sql`、`20260928150000_orders_rls.sql` 的内容；
   - 也可以让 WorkBuddy 帮你执行（它会走官方的迁移流程，自动校验文件一致性）。

**执行成功的验证方式**：在 SQL 控制台执行下面这句，应返回 `rowLevelSecurityEnabled: true` 和 4 条策略：

```sql
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'orders';
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'orders';
```

### 4. 编译运行

点「编译」，即可浏览菜单、加购物车、下单。按「预览」扫码，手机也能看。

- **域名校验**：本项目**不需要**勾选「不校验合法域名」。小程序直连数据库走的是云开发内部通道，不受 `wx.request` 合法域名限制。
- **真机调试**报 `800059 file not found` 时：工具内「清除缓存 → 重新编译」，或关闭项目重新打开（文件索引缓存问题）。

### 5. 发布体验版（想让对方用手机访问时）

1. 开发者工具右上角「**上传**」→ 填版本号（如 `1.0.1`）。
2. mp.weixin.qq.com → 管理 → 版本管理 → 开发版本 →「**选为体验版**」。
3. 成员管理 → 体验成员 → 把对方的微信号加进去。
4. 体验版二维码发给对方即可。

> 对方打开时**不需要再做任何配置**：数据库连接和权限都在小程序内部完成，对方只要被加进体验成员即可。

## ☁️ 数据模型

**dishes（菜单）** — 内置数据，见 `data/dishes.js`

| 字段          | 类型     | 说明                   |
| ----------- | ------ | -------------------- |
| id          | number | 主键（**纯数字**，本地服务分配）   |
| name        | string | 菜名                   |
| category    | string | 分类，默认 '经典热菜'         |
| emoji       | string | 展示图标，默认 '🍴'         |
| spice       | string | 辣度：不辣 / 微辣 / 中辣 / 特辣 |
| description | string | 介绍                   |
| created_at  | number | 创建时间（毫秒时间戳）          |

> **id 必须是纯数字**：`pages/checkout` 用 `Number(dataset.id)` 做购物车加减，字符串 id 会得到 `NaN` 导致加减失效。
> 用户在小程序里加菜 / 改菜会写入**本地覆盖层**（`wx.setStorageSync('dishes_override_v1')`），不改动内置数据；删除内置菜则记入黑名单 `dishes_deleted_v1`，避免重启后「复活」。

**orders（订单）** — CloudBase PostgreSQL 表，见 `cloudbase/migrations/20260928140000_create_orders.sql`

| 字段              | 类型          | 说明                                         |
| --------------- | ----------- | ------------------------------------------ |
| id              | BIGINT      | 主键（自增，**经接口返回为字符串**以免精度丢失）                 |
| items           | JSONB       | 菜品快照 `[{dishId, name, emoji, spice, qty}]` |
| remark          | TEXT        | 订单备注，默认空串                                  |
| order_by        | TEXT        | 点菜人，默认 '宝贝'                                |
| owner_openid    | TEXT        | 下单人 openid，默认空串（预留字段，当前未使用）                |
| status          | TEXT        | pending（待开做）/ cooking（开做中）/ done（已上菜）      |
| created_at      | TIMESTAMPTZ | 创建时间，默认 `now()`                            |
| updated_at      | TIMESTAMPTZ | 更新时间，默认 `now()`                            |

约束与索引：

- `CHECK (status IN ('pending','cooking','done'))` —— 状态只允许这三个值，脏数据进不来
- `orders_created_at_idx ON orders (created_at DESC)` —— 订单按时间倒序列表走索引

> **items 里的 `spice` 是用户下单时选定的辣度**，不一定等于菜品自身的推荐辣度。
> 同一道菜如果点了两种辣度，会在 `items` 里存成两条独立记录（`dishId` 相同、`spice` 不同），各自带自己的数量。
> 购物车同理：条目以「菜 + 辣度」为唯一键（`dishId|spice`），因此改数量、删除都只影响对应那一条。
>
> **`created_at` / `updated_at` 返回给页面时会被转成毫秒数**：PG 的 `timestamptz` 取回来是 ISO 字符串，而页面层 `utils/format.js` 的 `formatTime` 期望毫秒数，转换逻辑在 `utils/orders.js` 的 `toMillis()`。

### 🔐 权限模型（关键，出问题先看这里）

PostgreSQL 的权限是**两层**的，两层都通过才成功：

| 层    | 内容                          | 说明                 |
| ---- | --------------------------- | ------------------ |
| 第一层  | 表级 `GRANT`                  | 决定这个角色「能不能碰这张表」    |
| 第二层  | 行级 `RLS 策略`                 | 决定这个角色「能碰表里的哪些行」   |

`orders` 表已启用了 RLS，且策略配为「**已登录的微信用户可读、可写全部订单**」——因为订单是「两个人共享同一份」的语义，不需要按人隔离。

**三种数据库角色**：

| 角色              | 谁                        | 默认权限          |
| --------------- | ------------------------ | ------------- |
| `anon`          | 未登录访问                    | 默认仅 `SELECT`  |
| `authenticated` | 已登录的微信用户                 | **本项目的订单读写者** |
| `service_role`  | 管理员（绕过 RLS）              | 全权限           |

> **RLS 的本质是「默认拒绝一切」**：只要表启用了 RLS 却没有匹配的策略，所有操作都会被拒绝。
> 所以「表建好了但读不出来 / 写不进去」几乎一定是策略没配或没配全，而不是代码问题。

## 🔌 接口

所有前端调用都通过 `utils/api.js` 的 `call(action, payload)` 发出。菜品走本地实现，订单走 PostgreSQL：

| action              | 走向 | 参数                                   | 说明                       |
| ------------------- | -- | ------------------------------------ | ------------------------ |
| `listDishes`        | 本地 | `{ category?, keyword? }`            | 拉取菜品（支持分类 / 关键词过滤）       |
| `getDish`           | 本地 | `{ id }`                             | 取单道菜                     |
| `saveDish`          | 本地 | `{ id?, payload }`                   | 新增（无 id）或增量修改（有 id）      |
| `deleteDish`        | 本地 | `{ id }`                             | 下架菜品（幂等）                 |
| `listOrders`        | PG | —                                    | 拉取最近 200 条订单，按创建时间倒序     |
| `createOrder`       | PG | `{ payload: { items, remark, order_by } }` | 下单                       |
| `getOrder`          | PG | `{ id }`                             | 取单笔订单（编辑页用），不存在返回 `null` |
| `updateOrder`       | PG | `{ id, payload }`                    | 编辑订单：改菜品 / 备注 / 点菜人 / 状态 |
| `updateOrderStatus` | PG | `{ id, status }`                     | 推进订单状态                   |
| `deleteOrder`       | PG | `{ id }`                             | 删除订单                     |

> 想给订单加新接口？在 `utils/orders.js` 里加一个函数，挂进 `ACTIONS` 表，再把 action 名加进 `utils/api.js` 的 `ORDER_ACTIONS` 数组即可。

## ❓ 常见问题

**Q：手机真机 / 体验版提示「菜单没加载出来」？**
菜单是内置数据，正常不会出现。若出现，检查是不是改坏了 `data/dishes.js`（在开发者工具「调试器 → Console」看报错）。

**Q：订单页报「基础库版本过低（需 2.2.3+）」？**
微信基础库太老。开发者工具 → 详情 → 本地设置 → 把「调试基础库」调高（选 3.x 版本）。

**Q：订单报「permission denied for table orders」？**
数据库权限没配好。回到「快速开始」第 3 步，确认：
1. migration 里的 `GRANT ... TO authenticated` 执行了；
2. RLS 策略（4 条：SELECT / INSERT / UPDATE / DELETE）都在；
3. 你正处于**已登录**状态（`authenticated` 角色），而不是匿名。

**Q：小程序报「暂不支持 npm 模块：@cloudbase/wx-cloud-client-sdk」？**
说明运行时找不到 `miniprogram_npm/`。依次试：① 重新点「编译」；② 「工具 → 清除缓存 → 清除全部缓存」后重新编译；③ 检查项目里 `miniprogram_npm/@cloudbase/wx-cloud-client-sdk/` 是否存在——被误删的话，在项目根目录 `npm install` 后执行「工具 → 构建 npm」重新生成。

**Q：改完代码后订单功能突然不好用了？**
先想想是不是刚改过 `package.json`。改动依赖后要 `npm install` 并重新「构建 npm」。

**Q：真机调试报 800059 file not found？**
开发者工具的文件索引缓存问题：清除缓存 → 重新编译；无效则关闭项目重新打开。

**Q：数据库免费额度会过期吗？**
会。**小程序正式发布上线后**，免费环境会变成「上线后第 15 天到期」，到期后不转付费（约 19.9 元/月）环境会被回收、数据不可找回。只在开发者工具 / 体验版阶段使用通常不受影响，但建议在正式发布前评估。
好消息：**菜单在代码里，永远不会丢**，风险只涉及订单数据。

**Q：菜品超过 100 道还能拉全吗？**
可以。内置数据不受此限制。订单侧 `listOrders` 一次最多取 200 条（`range(0, 199)`），日常使用绰绰有余；超出后只显示最近 200 条。

## 🗺 Roadmap

- [ ] 菜品图片上传
- [ ] 订单实时刷新（数据库实时推送）
- [ ] 吃完打卡 / 美食日记
- [ ] 上菜提醒通知

## 📄 许可

仅供学习交流使用。欢迎 Fork，改成你们自己的专属小厨房 💕
