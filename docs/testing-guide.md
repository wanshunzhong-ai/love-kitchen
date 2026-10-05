# 测试与质量流程（契约测试）

本项目的护栏是**契约测试**：`.workbuddy/tmp/test_*.js`，纯 node 跑，不依赖微信开发者工具。
每次改动后跑全量 + 三个静态体检脚本。本文是写测试与改护栏的完整说明；`MEMORY.md` 只留摘要与指针。

## 一、入口与运行方式

```bash
cd .workbuddy/tmp && node test_xxx.js        # 单个
cd .workbuddy/tmp && for f in test_*.js; do node "$f"; done   # 全量
```

判定是否全绿（各文件摘要行格式不统一，用 ❌ 计数最稳）：

```bash
cd .workbuddy/tmp && red=""; ok=0; for f in test_*.js; do
  out=$(node "$f" 2>&1); bad=$(echo "$out" | grep -c "❌")
  if [ "$bad" != "0" ]; then red="$red $f($bad)"; else ok=$((ok+1)); fi
done; echo "OK=$ok"; echo "RED=$red"
```

静态体检（改动后必跑）：

| 脚本 | 作用 |
| --- | --- |
| `audit_wxml.py` | wxml 标签配平（逐字符扫描，**不能用正则**，见下） |
| `audit_pack.py` | 上传包体检：白名单体积、逐文件 JS 语法 |
| `test_style_compat.js` | 样式兼容契约（不用 flex gap / 安全区双写 / 字号下限 / `:active` 等） |

**`test_cloudfn.js` / `test_orders_pg.js` 测的是已废弃架构**（云函数 / 自建 PG），**长期红着**，不是回归。

**这些测试与脚本在 `.workbuddy/` 下，是 gitignore 的，不进仓库**（既有约定）。

## 二、测试文件与规模

`test_batch2` / `test_batch3` / `test_batch4` / `test_batch5` 是逐批新增的清单项护栏；
`test_dish_cloud` / `test_order_sync` 是 C28 菜单共享 / C8 增量轮询的护栏；其余按模块分。

**改完一批先看断言总数有没有掉 —— 掉了说明护栏被顺手删了。**

## 三、假环境怎么搭

- **wx 桩**：`require` 页面模块前把 `global.Page` / `global.Component` 设成捕获定义的函数，
  每次 `delete require.cache` 重新装载；`setData` 桩**必须支持 `'a.b'` 路径写法**。
- **假 SDK 拦截 require**：`utils/cloud.js` 是**懒加载**（`require('./cloud')` 零副作用），
  所以纯本地模块的单测不必装 SDK 桩；真要测云路径时在 `require` 前拦截 `@tencent-ai/workbuddy-cloud-sdk`。
- **假 SDK 桩必须按表分开存**：`cloud.rows` 一个数组装所有表的话，「云端表里有几行」的断言会被
  `dish_logs` 的日志行污染。要 `cloud.tables = { dishes: [], dish_logs: [] }` + 按表的 `seq`。
- **失败开关要设成「粘住」的**（不自动消耗）：`saveDish` 里 `dishLogs.record` 也是一次
  fire-and-forget insert，先被吃掉的话被测的那次 `pushAdd` 反而成功了。
- **假云端必须返回深拷贝**：`io.orders.slice()` 只换了数组、**元素还是同一批引用**，
  测试里改 `data[0]` 会连带改到被测模块的缓存（得到假红）。真机每次响应都是新反序列化的对象，桩要照着仿真。
- **弹窗用「可手动应答的 `showModal` 桩」**：不能自动回调，否则测不了「弹窗还开着时又轮询到一轮」
  （见 `test_dine_deadline.js` 的 `pendingModal` + `answerModal`）；测异步编排先 `await flush()`。
- **单例搬家要同步测试桩**：`_cloud` 从 `orders.js` 搬到 `cloud.js` 后，
  `test_orders_workbuddy.js::loadOrders()` 的 `delete require.cache` **必须连 cloud.js 缓存一起清**，
  否则「重置」拿回旧客户端（【I】组假红）。

## 四、写测试的五条（做不到就是假护栏）

1. **时序行为（防抖 / 节流 / 重入）必须做行为测试**：挂 `setData` 桩后直接调 handler 驱动。
   「连打 5 字符只过滤 1 次」要**包装 `applyFilter` 计数** + `await sleep(280)`。
   并发保护的判据用「**`loading` 有没有被重新置 true**」，**别自己数调用次数**
   （容易从不自增、断言空转）。
2. **别写「复刻一份实现」的测试**：`test_menu_search.js` 原先抄了一份 `applyFilter` ——
   **测的是副本，真实现漂移它不会红**，比没护栏更危险。抽 `utils/dish-search.js` 后改成 `require` 真实现。
3. **别用会被自己骗到的写法**：
   - 正则遇多行写法失配（`api\n  .call(…)`）；
   - `class="ps"` 匹配不上 `class="ps {{…}}"`；
   - 查「不该出现的标识」命中**自己刚写的注释**（要 `stripComments`，wxml 还要去 `<!-- -->`）；
   - 切片锚点命中**无关 handler**（同名属性在别的 handler 里也有）→ 用 `indexOf('\n  fnName() {')`，别用调用点。
4. **先取出整个标签再查属性**：**属性值里合法地出现 `>`**（`rating >= s`、`list.length > 0`），
   对标签用 `[^>]*` / `[\s\S]{0,N}` 都会提前截断 → 断言假红。
   正解：`lastIndexOf('<', i)` ~ `indexOf('>', i)` 取出标签，再在标签内查。
   `audit_wxml.py` 的标签扫描同理 —— **必须逐字符、不能用正则**，否则自闭合的 `<state-block … />`
   会报「未闭合」。
5. **`const` 没有变量提升（TDZ）**：抽常量时 `require` 必须放在**第一次使用之前**，
   否则模块加载直接 `ReferenceError: Cannot access 'X' before initialization`，整个 require 链全炸
   （`utils/orders.js` 踩过，连带 18 个测试文件红）。

## 五、护栏变红时怎么办（改断言，不删断言）

重构与新增**必然**让某些断言变红，那是护栏该有的行为：

| 改动 | 会红的护栏 | 正确做法 |
| --- | --- | --- |
| 改 class / 渐变字面量 / 下标名 | `test_batch4` 等结构类断言 | 更新断言指向新写法（`bind:retry` / `var(--grad-main)` / `data-id` / `STATUS.cooking` / `statusKeys.pending`） |
| 结构搬进组件 | `test_checkout_contract.js`（20+ 条） | 断言**一起搬**到 `components/cart-list/cart-list.wxml` —— 组件两页共用，破坏它同时坏两页 |
| 加一个 action | `test_csv.js`（`dishes.ACTIONS` 个数）、`test_local_dishes.js`（`api.DISH_ACTIONS`）、`test_orders_workbuddy.js` / `test_review.js`（`orders.ACTIONS`） | 更新计数**并写明原因** |
| 加一个页面 | `test_csv.js`（pages 计数）、`test_orders_workbuddy.js`（pages 清单）、`test_ui_helper.js`（**每页都必须 `require('../../utils/ui')`**，哪怕只用 `ui.haptic`） | 同步三处 |
| 魔法值换成常量 | `test_live` / `test_todo` / `test_order_roles` / `test_roles` / `test_review` / `test_final_order` | 断言改指常量，不删 |

## 六、按标签扫描而非按行

wxml 属性常分多行写，**按行插入会把属性插到标签外**。批量改 wxml 的脚本（`refactor_*.py` /
`add_hover_aria.py`）都走「先定位整个标签、再在标签内替换」，且**锚点找不到就报错退出**，可安全复跑。

## 七、推送

```bash
git -c credential.interactive=false \
    -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 \
    push origin main
git ls-remote origin refs/heads/main   # 复核
```
