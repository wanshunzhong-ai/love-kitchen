# 🍳 爱心小厨房 Love Kitchen

一个**两人共用**的点菜微信小程序：翻菜单、加点想吃的、备注辣度忌口，大厨在订单页看着进度做菜。适合情侣 / 家人搭伙做饭，也适合作为「微信小程序 + 云开发」的入门学习项目。

## ✨ 功能特性

- 📖 **菜单分类浏览**：荤菜 / 素菜 / 汤 / 主食 / 甜品 / 其他
- 🛒 **购物车下单**：数量加减、一键下单、点菜人署名
- 💬 **订单备注**：辣度、忌口、想说的小留言
- 👩‍🍳 **订单状态跟踪**：待开做 → 开做中 → 已上菜，双方都能推进状态
- 🌶️ **辣度四档**：不辣 / 微辣 / 中辣 / 特辣，菜品卡、购物车、订单明细全程可见
- 🎲 **今天吃什么**：选择困难症一键随机推荐
- ➕ **自助维护菜单**：直接在小程序里加菜、改菜、下架

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 微信原生小程序（WXML / WXSS / JS），零框架零依赖 |
| 后端 | WorkBuddy Cloud（Serverless，免服务器运维） |
| 数据库 | PostgreSQL + 行级安全（RLS） |
| 客户端 SDK | `@tencent-ai/workbuddy-cloud-sdk`（supabase-js 风格 API，小程序专用构建已内置） |

## 📂 项目结构

```
love-kitchen/
├── app.js / app.json / app.wxss     # 应用入口、tabBar 与全局样式
├── pages/
│   ├── menu/        # 点菜页：分类、购物车、随机帮选
│   ├── checkout/    # 确认订单：数量、备注、点菜人
│   ├── orders/      # 订单页：状态跟踪与推进
│   └── dish-edit/   # 加菜 / 编辑 / 下架
├── utils/
│   ├── cloud.js                       # 云客户端（endpoint + publishableKey）
│   ├── constants.js                   # 分类 / 辣度 / 订单状态常量
│   ├── store.js                       # 购物车与昵称（本地存储）
│   ├── format.js                      # 时间格式化
│   └── workbuddy-cloud-diagnostics.js # 云请求诊断日志
├── miniprogram_npm/                 # 预构建云 SDK（克隆即用，无需再构建）
└── project.config.json
```

## 🚀 快速开始

### 1. 克隆并导入

```bash
git clone https://github.com/wanshunzhong-ai/love-kitchen.git
```

打开「微信开发者工具」→ 导入项目 → 选择仓库目录。AppID 填你自己的小程序 AppID（仓库中的 AppID 可直接替换）。

### 2. 依赖说明

云 SDK 构建产物已内置在 `miniprogram_npm/`，**克隆即可运行**，不需要 `npm install`。
如果产物被清理过：先 `npm install`，再在开发者工具点「工具 → 构建 npm」。

### 3. 本地运行注意

- **域名校验**：开发阶段需勾选「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。本项目已通过 `project.private.config.json` 预设 `urlCheck: false`，正常导入即生效。
- **真机调试**报 `800059 file not found` 时：工具内「清除缓存 → 重新编译」，或关闭项目重新打开（文件索引缓存问题）。

## ☁️ 云端配置

`utils/cloud.js` 中的 `endpoint` 与 `publishableKey` 是应用级**公开配置**——它们不含任何密钥，服务端按请求来源校验，因此可以放进前端代码。当前连接的是作者的云端环境。

想换成自己的环境：开通 WorkBuddy 云服务后替换这两个值，并按下方 SQL 建表。

### 数据模型

**dishes（菜单）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT IDENTITY | 主键 |
| name | TEXT NOT NULL | 菜名 |
| category | TEXT，默认 '其他' | 分类 |
| emoji | TEXT，默认 '🍽️' | 展示图标 |
| spice | TEXT，默认 '不辣' | 辣度：不辣 / 微辣 / 中辣 / 特辣 |
| description | TEXT | 介绍 |
| created_at | TIMESTAMPTZ | 创建时间 |

**orders（订单）**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT IDENTITY | 主键 |
| items | JSONB NOT NULL | 菜品快照 `[{dishId, name, emoji, spice, qty}]` |
| remark | TEXT | 订单备注 |
| order_by | TEXT，默认 '宝贝' | 点菜人 |
| status | TEXT，默认 'pending' | pending（待开做）/ cooking（开做中）/ done（已上菜） |
| created_at / updated_at | TIMESTAMPTZ | 时间 |

**建表 SQL（含两人共享的 RLS 策略）**

```sql
CREATE TABLE dishes (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT '其他',
  emoji       TEXT        NOT NULL DEFAULT '🍽️',
  spice       TEXT        NOT NULL DEFAULT '不辣',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  items      JSONB       NOT NULL,
  remark     TEXT,
  order_by   TEXT        NOT NULL DEFAULT '宝贝',
  status     TEXT        NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dishes TO authenticated, anon;
CREATE POLICY dishes_couple_all ON dishes FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO authenticated, anon;
CREATE POLICY orders_couple_all ON orders FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
```

## ❓ 常见问题

**Q：模拟器提示「菜单没加载出来，网络可能开小差了」？**
开发阶段未走正式发布，接口域名不在微信白名单里，勾选「不校验合法域名」即可（见快速开始第 3 步）。正式发布时域名会自动注册。

**Q：真机调试报 800059 file not found？**
开发者工具的文件索引缓存问题：清除缓存 → 重新编译；无效则关闭项目重新打开。

**Q：提示找不到模块 `@tencent-ai/workbuddy-cloud-sdk`？**
`npm install` 后在开发者工具点「工具 → 构建 npm」。

## 🗺 Roadmap

- [ ] 菜品图片上传
- [ ] 订单实时刷新（数据库 watch）
- [ ] 吃完打卡 / 美食日记
- [ ] 上菜提醒通知

## 📄 许可

仅供学习交流使用。欢迎 Fork，改成你们自己的专属小厨房 💕
