/**
 * 账单 API（全部需要店长权限，在 index.js 统一挂了 requireAdmin）
 * - GET /api/bills?date=YYYY-MM-DD   按天查账单（默认今天）
 * - GET /api/bills/stats/today       今日营业统计
 * - GET /api/bills/:id               账单详情（含并入的订单明细，可用于打印小票）
 */
const express = require('express');
const db = require('../db');
const { round2, localDateStr } = require('../utils/helpers');
const { calcTableFee } = require('../utils/pricing');

const router = express.Router();

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// 日期参数统一解析：未传/空串 → 今天；'all' → 不限日期（列表与统计口径一致）
function parseDateQuery(q) {
  return q === undefined || q === '' ? localDateStr() : q;
}

// ---------- 营业统计（放在 /:id 之前注册，避免被当成 id） ----------
router.get('/stats/today', (req, res) => {
  const date = parseDateQuery(req.query.date);
  const where = date === 'all' ? '' : 'WHERE bill_date = ?';
  const args = date === 'all' ? [] : [date];

  const row = db.prepare(
    `SELECT COUNT(*)          AS bill_count,
            IFNULL(SUM(pay_amount), 0)   AS total_pay,
            IFNULL(SUM(table_fee), 0)    AS total_table_fee,
            IFNULL(SUM(goods_fee), 0)    AS total_goods_fee,
            IFNULL(SUM(discount), 0)     AS total_discount
       FROM bills ${where}`
  ).get(...args);

  // 按支付方式分组统计（现金/微信/支付宝各收了多少）
  const byMethod = db.prepare(
    `SELECT pay_method, COUNT(*) AS cnt, IFNULL(SUM(pay_amount),0) AS amount
       FROM bills ${where} GROUP BY pay_method`
  ).all(...args);

  res.json({ date, ...row, by_method: byMethod });
});

// ---------- 账单列表（按天查询，默认今天；date=all 查全部） ----------
router.get('/', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const date = parseDateQuery(req.query.date);

  let sql = 'SELECT * FROM bills';
  const args = [];
  if (date !== 'all') { sql += ' WHERE bill_date = ?'; args.push(date); }
  sql += ` ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 100, 500)} OFFSET ${Number(offset) || 0}`;

  const list = db.prepare(sql).all(...args);
  res.json(list);
});

// ---------- 进行中的桌台（已接单未结桌） ----------
// 每张使用中的桌台实时汇总：累计桌费 + 已确认订单（含商品明细）。
// 供店长后台「账单查询」页同步显示：订单一旦被接受，这里立刻能看到
router.get('/in-progress', (req, res) => {
  const occupied = db.prepare(
    `SELECT * FROM tables WHERE status = 'occupied' ORDER BY opened_at`
  ).all();

  const ordersStmt = db.prepare(
    `SELECT * FROM orders WHERE table_id = ? AND status = 'confirmed' ORDER BY id`
  );
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');

  const list = occupied.map((t) => {
    const fee = calcTableFee(t.opened_at, t); // 与结桌账单同口径的累计桌费
    const orders = ordersStmt.all(t.id);
    for (const o of orders) o.items = itemsStmt.all(o.id);
    const goodsFee = round2(orders.reduce((s, o) => s + Number(o.total_amount), 0));
    return {
      table_id: t.id,
      table_name: t.name,
      opened_at: t.opened_at,
      minutes: fee.minutes,
      billed_hours: fee.billedHours,
      hourly_rate: fee.hourlyRate,
      table_fee: fee.tableFee,
      orders,
      goods_fee: goodsFee,
      estimate_total: round2(fee.tableFee + goodsFee),
    };
  });
  res.json(list);
});

// ---------- 账单详情（含这桌并入账单的订单和商品明细，打印小票用） ----------
router.get('/:id', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) throw httpErr(404, '账单不存在');

  // 该账单关联的订单（结桌时标记 bill_id）
  const orders = db.prepare(
    'SELECT * FROM orders WHERE bill_id = ? ORDER BY created_at'
  ).all(bill.id);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = itemsStmt.all(o.id);

  res.json({ ...bill, orders });
});

module.exports = router;
