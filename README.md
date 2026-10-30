# 🀄 棋牌室收银下单系统

轻量级 Web 应用：**店长后台**（桌台看板、商品管理、订单处理、账单汇总/打印）+ **顾客移动端**（扫码选桌、自助开台、点单）。

- 技术栈：Node.js + Express + SQLite（Node 内置 `node:sqlite`，**零原生编译依赖**）
- 前端：原生 HTML/CSS/JS，无需构建工具，改完刷新即生效
- 数据：单文件数据库 `db/data.db`，备份就是复制这个文件

---

## 一、快速启动

### 1. 安装 Node.js（仅首次）
到 <https://nodejs.org/zh-cn> 下载安装 **Node.js 22 LTS 或更高版本**（必须 ≥ 22.5，因为用到内置 SQLite）。
装好后在命令行确认：`node -v` 显示 v22.x / v24.x 即可。

### 2. 安装依赖（仅首次，只有一个 express，几秒钟）
```bash
cd qipaishi-pos
npm install
```
> 国内网络慢可用镜像：`npm install --registry=https://registry.npmmirror.com`

### 3. 启动
```bash
npm start
```
首次启动会自动建表并导入示例桌台（A1~C2 共 8 桌）和示例商品（香烟/饮料/零食）。

### 4. 访问
| 页面 | 地址 | 说明 |
|---|---|---|
| 导航页 | http://localhost:3000/ | 选择入口 |
| 店长后台 | http://localhost:3000/admin/ | **默认密码 123456** |
| 顾客点单 | http://localhost:3000/mobile/ | 手机访问见下文 |

### 5. 手机（顾客）怎么访问
手机与电脑连**同一个 WiFi**，查出电脑局域网 IP（Windows 命令行执行 `ipconfig`，看"IPv4 地址"，如 192.168.1.10），手机浏览器访问：
```
http://192.168.1.10:3000/mobile/
```

**扫码直达桌台**：每张桌贴一个二维码，内容为
```
http://192.168.1.10:3000/mobile/?table=A1
```
（把 A1 换成对应桌台名；二维码可用任意免费在线二维码生成工具生成）

### 6. 其他命令
```bash
npm run dev        # 开发模式：改后端代码自动重启
npm run reset-db   # ⚠ 清空数据库重建（恢复示例数据，慎用）
```

---

## 二、日常使用流程

1. **开台**：店长在「桌台看板」点空闲桌台的[开台]；或顾客扫码后自助开台。开台即开始计桌费。
2. **点单**：顾客手机端选商品 → 提交订单（可多次加单）。
3. **新订单提醒**：店长后台每 8 秒轮询，有新订单会"叮咚"响 + 右下角弹窗 + 页签红点角标，点[确认接单]后订单计入账单（取消订单会自动恢复库存）。
4. **结桌**：店长点使用中桌台的[结桌] → 自动算出 **桌费 + 商品费**，可填优惠金额、选收款方式 → 生成账单。
5. **查账/打印**：「账单查询」按天查看流水和营业统计（实收/桌费/商品收入/各收款方式），点[详情/打印]可打印 72mm 小票。

**计费规则**（`server/utils/pricing.js`）：
```
计费时长 = max(最低消费时长, 实际时长向上取整到整小时)
桌费     = 计费时长 × 每小时费率
```
想改成"按实际分钟折算"：把 `server/config.js` 里 `billing.roundUpToHour` 改为 `false`。

---

## 三、我要自己改东西，改哪里？

| 想做什么 | 去哪里改 |
|---|---|
| **新增商品 / 改价格 / 改库存** | 店长后台「商品管理」（推荐，即时生效）；或改 `db/seed.sql` 后 `npm run reset-db`（会清数据） |
| 新增/改桌台、费率、最低消费 | 店长后台「桌台看板」→ 新增/编辑桌台 |
| 新房型 / 新商品分类 | 后端 `server/routes/tables.js` 的 `ROOM_TYPES`、`products.js` 的 `CATEGORIES`，前端 `admin.js`、`mobile.js` 顶部同名常量，四处同步加一项即可 |
| 改后台密码 / 端口 | `server/config.js`（密码也可用环境变量 `ADMIN_PASSWORD`，端口 `PORT`） |
| 改计费规则 | `server/utils/pricing.js`（注释齐全） |
| 改界面颜色 | `public/admin/admin.css`、`public/mobile/mobile.css` |

> 商品**改名/调价/删除不影响历史订单和账单**——订单明细里存的是下单当时的名称和价格快照。

---

## 四、数据库

建表语句在 **`db/schema.sql`**（含详细注释），共 5 张表：

| 表 | 用途 |
|---|---|
| `tables` | 桌台：名称、房型、费率、最低消费、状态、开台时间 |
| `products` | 商品：名称、分类、单价、库存(-1=不限量)、上下架 |
| `orders` | 订单：桌台、状态(待处理/已确认/已取消/已结账)、金额、关联账单 |
| `order_items` | 订单明细：商品名/单价快照、数量、小计 |
| `bills` | 账单：时长、桌费、商品费、优惠、实收、支付方式、**支付预留字段** |

查看数据：安装任意 SQLite 工具（如 DB Browser for SQLite）打开 `db/data.db`。

---

## 五、支付功能扩展位（已预留）

当前版本只做**金额计算与记账**（收款方式为手工记录）。将来接微信/支付宝：

1. 数据库字段已备好：`bills.pay_status`（paid/unpaid/refunded）、`bills.transaction_id`（第三方流水号）；
2. 新建 `server/routes/pay.js`：调起预支付（Native 扫码支付最合适）+ 接收支付回调，回调成功后更新 `pay_status='paid'` 并写入 `transaction_id`；
3. 在 `server/index.js` 挂载：`app.use('/api/pay', require('./routes/pay'))`；
4. 把 `server/config.js` 中 `payment.enabled` 改为 `true`，前端据此显示"在线支付"按钮。

## 六、新订单提醒机制说明

采用**轮询**（店长后台每 8 秒调 `GET /api/notify/new-orders?since_id=最后已见订单id`），局域网内延迟≈8 秒，实现简单可靠、断网自动恢复。
想要秒级推送可换 WebSocket（socket.io）或 SSE，前端只需改 `admin.js` 中的 `pollNewOrders()`，后端接口返回格式不变即可兼容。

---

## 七、API 一览（方便二次开发/对接小程序）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/login` | 公开 | 店长登录 `{password}` → `{token}` |
| GET | `/api/tables` | 公开 | 桌台列表 |
| POST | `/api/tables/:id/open` | 公开 | 开台 `{customer_name?, remark?}` |
| POST | `/api/tables` / PUT / DELETE | 店长 | 桌台增改删 |
| GET | `/api/tables/:id/bill-preview` | 店长 | 结桌前账单预览 |
| POST | `/api/tables/:id/close` | 店长 | 结桌 `{discount, pay_method, remark}` → 生成账单 |
| GET | `/api/products?category=` | 公开(上架)/店长(全部 `?all=1`) | 商品列表 |
| POST/PUT/DELETE | `/api/products[/:id]` | 店长 | 商品增删改 |
| POST | `/api/orders` | 公开 | 顾客下单 `{table_id, items:[{product_id,quantity}], remark}` |
| GET | `/api/orders?table_id=&status=` | 按桌公开 / 全部需店长 | 订单列表 |
| POST | `/api/orders/:id/confirm` \| `/cancel` | 店长 | 确认 / 取消订单 |
| GET | `/api/notify/new-orders?since_id=` | 店长 | 新订单提醒（轮询） |
| GET | `/api/bills?date=YYYY-MM-DD` | 店长 | 账单列表（`date=all` 查全部） |
| GET | `/api/bills/stats/today?date=` | 店长 | 营业统计 |
| GET | `/api/bills/:id` | 店长 | 账单详情（含明细，打印用） |
| GET | `/api/bills/in-progress` | 店长 | 进行中的桌台（累计桌费+已接单订单，账单查询实时区） |

店长接口鉴权方式：请求头 `x-admin-token: <登录返回的token>`。

---

## 八、常见问题

- **启动报错 `node:sqlite` 找不到**：Node 版本低于 22.5，升级 Node 即可。
- **端口被占用**：改 `server/config.js` 的 `port`，或 `set PORT=3001 && npm start`。
- **数据全乱了想重来**：`npm run reset-db` 然后 `npm start`（会恢复示例数据）。
- **手机打不开页面**：确认手机和电脑同一 WiFi、电脑防火墙放行 3000 端口（首次启动时 Windows 弹窗选"允许"）。
- **打印机小票宽度**：打印样式默认 72mm（常见热敏小票纸），其他宽度改 `admin.css` 底部 `@media print` 里的 `width`。

## 九、目录结构

```
qipaishi-pos/
├── package.json            # 依赖与启动脚本
├── db/
│   ├── schema.sql          # ★ 数据库建表语句（含注释）
│   ├── seed.sql            # ★ 示例桌台/商品数据（可改成你店的）
│   └── data.db             # SQLite 数据文件（运行后生成，备份=复制它）
├── server/
│   ├── index.js            # 服务入口
│   ├── config.js           # ★ 全局配置（端口/密码/计费开关/支付预留）
│   ├── db.js               # 数据库连接、自动建表、事务封装
│   ├── auth.js             # 店长登录鉴权
│   ├── utils/pricing.js    # ★ 桌费计算规则
│   ├── utils/helpers.js    # 时间/金额/单号工具
│   └── routes/             # tables / products / orders / bills / notify
├── public/
    ├── index.html          # 导航页
    ├── admin/              # ★ 店长后台（index.html + admin.js + admin.css）
    └── mobile/             # ★ 顾客移动端（index.html + mobile.js + mobile.css）
└── miniprogram/            # 微信小程序·顾客自助点单（用微信开发者工具打开此目录）
    ├── app.js / app.json / app.wxss
    ├── utils/              # api.js（请求封装）/ config.js（★ 后端地址）
    └── pages/              # tables 选桌开台 / shop 点单 / orders 我的订单
```
（带 ★ 的是你日后最常改的文件）

---

## 十、微信小程序（顾客自助点单）

`miniprogram/` 目录是一个完整的微信小程序工程，功能与顾客移动端网页一致：
选桌/扫码直达 → 开台确认弹层 → 分类点单+购物车 → 提交订单 → 我的订单（15 秒轮询刷新）。
**后端零改动**，直接复用第七节的公开 API；店长后台仍用网页端。

### 局域网试用（无需注册账号也能看界面）

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，导入项目时选择 `miniprogram/` 目录；AppID 可先选"测试号"
2. 改 `miniprogram/utils/config.js` 的 `BASE_URL` 为收银电脑局域网 IP（如 `http://192.168.0.105:3000`）
3. 开发者工具「详情 → 本地设置」勾选 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**
4. 模拟器里即可走完整流程；真机预览需 own AppID（见下），手机开启开发调试后同样直连局域网

### 正式上线给顾客扫（必须满足）

1. 在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册小程序账号（个人主体免费），拿到 AppID 填进 `miniprogram/project.config.json`
2. 后端部署到**公网服务器 + HTTPS + ICP 备案域名**（局域网 IP 无法过审），把该域名加入小程序后台「开发管理 → 开发设置 → request 合法域名」
3. 提交代码审核、发布；此后顾客扫**小程序码**进入
4. 每桌的小程序码：调用微信 `wxacode.getUnlimited` 接口生成，`scene` 传桌台名（如 `A1`），小程序已支持解析（`app.js` onLaunch）；需要的话可以在后端加一个生成/下载二维码的接口

> 注意：未发布前，体验版/开发版只有"体验成员"能打开，顾客扫码进不来——这是微信的平台规则，与代码无关。
