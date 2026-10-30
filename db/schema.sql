-- ============================================================
-- 棋牌室收银下单系统 —— 数据库建表语句（SQLite）
-- 首次启动服务时自动执行；也可手动: sqlite3 db/data.db < db/schema.sql
-- ============================================================

-- ---------- 桌台表 ----------
CREATE TABLE IF NOT EXISTS tables (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,        -- 桌台名，如 "A1"（也是二维码/网址里的编号）
  room_type   TEXT    NOT NULL DEFAULT 'standard', -- 房型: standard=标准间 deluxe=豪华间 vip=VIP包间
  hourly_rate REAL    NOT NULL DEFAULT 20,    -- 桌费费率（元/小时）
  min_hours   REAL    NOT NULL DEFAULT 1,     -- 最低消费时长（小时），不足按此计
  status      TEXT    NOT NULL DEFAULT 'idle',-- idle=空闲 occupied=使用中
  opened_at   TEXT,                           -- 开台时间（ISO 字符串，结桌后清空）
  customer_name TEXT,                         -- 开台顾客称呼（可空）
  remark      TEXT,                           -- 备注
  created_at  TEXT    NOT NULL                -- 创建时间
);

-- ---------- 商品表（香烟/饮料/零食） ----------
CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,                -- 商品名
  category   TEXT    NOT NULL DEFAULT 'snack',-- 分类: cigarette=香烟 drink=饮料 snack=零食 other=其他
  price      REAL    NOT NULL,                -- 单价（元）
  stock      INTEGER NOT NULL DEFAULT -1,     -- 库存数量；-1 表示不限量
  is_active  INTEGER NOT NULL DEFAULT 1,      -- 1=上架 0=下架（下架后顾客端不可见）
  remark     TEXT,
  created_at TEXT    NOT NULL
);

-- ---------- 订单表（顾客在桌台上下的商品单，可多次加单） ----------
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no     TEXT    NOT NULL UNIQUE,       -- 订单号，如 DD20261030123001-456
  table_id     INTEGER NOT NULL REFERENCES tables(id),
  status       TEXT    NOT NULL DEFAULT 'pending',
               -- pending=待处理 confirmed=已确认 cancelled=已取消 settled=已结账(并入账单)
  total_amount REAL    NOT NULL DEFAULT 0,    -- 商品合计金额（下单时按当时价格快照计算）
  bill_id      INTEGER,                       -- 结账后关联的账单 id（未结账为 NULL）
  remark       TEXT,                          -- 顾客备注
  created_at   TEXT    NOT NULL,
  confirmed_at TEXT                            -- 店长确认时间
);
CREATE INDEX IF NOT EXISTS idx_orders_table  ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ---------- 订单明细表 ----------
-- 商品名/单价做“快照”存储：之后改名、调价、删商品都不影响历史订单
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER,                       -- 来源商品 id（商品被删除后仍保留快照）
  product_name TEXT    NOT NULL,              -- 快照：下单时商品名
  unit_price   REAL    NOT NULL,              -- 快照：下单时单价
  quantity     INTEGER NOT NULL,              -- 数量
  subtotal     REAL    NOT NULL               -- 小计 = unit_price × quantity
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- ---------- 账单表（结桌时生成，一桌一单） ----------
CREATE TABLE IF NOT EXISTS bills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no       TEXT    NOT NULL UNIQUE,      -- 账单号，如 ZD20261030-abc
  bill_date     TEXT    NOT NULL,             -- 本地日期 YYYY-MM-DD（方便按天查询/统计）
  table_id      INTEGER NOT NULL,
  table_name    TEXT    NOT NULL,             -- 快照：桌台名
  room_type     TEXT,                         -- 快照：房型
  customer_name TEXT,
  opened_at     TEXT    NOT NULL,             -- 开台时间
  closed_at     TEXT    NOT NULL,             -- 结桌时间
  duration_minutes INTEGER NOT NULL,          -- 实际时长（分钟）
  billed_hours  REAL    NOT NULL,             -- 计费时长（小时）
  hourly_rate   REAL    NOT NULL,             -- 快照：当时费率
  table_fee     REAL    NOT NULL,             -- 桌费
  goods_fee     REAL    NOT NULL,             -- 商品费（已确认订单合计）
  total_amount  REAL    NOT NULL,             -- 应收 = 桌费 + 商品费
  discount      REAL    NOT NULL DEFAULT 0,   -- 优惠金额
  pay_amount    REAL    NOT NULL,             -- 实收 = 应收 - 优惠
  pay_method    TEXT    NOT NULL DEFAULT 'cash', -- cash=现金 wechat=微信 alipay=支付宝 card=刷卡
  pay_status    TEXT    NOT NULL DEFAULT 'paid', -- 预留：paid=已付 unpaid=未付 refunded=已退款
  transaction_id TEXT,                        -- 预留：第三方支付流水号
  remark        TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bills_date  ON bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_bills_table ON bills(table_id);
