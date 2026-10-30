/**
 * 账单 API（全部需要店长权限，在 index.js 统一挂了 requireAdmin）
 * - GET /api/bills?date=YYYY-MM-DD   按天查账单（默认今天）
 * - GET /api/bills/stats/today       今日营业统计
 * - GET /api/bills/:id               账单详情（含并入的订单明细，可用于打印小票）
 */
const express = require('express');
const db = require('../db');
const { round2, localDateStr } = require('../utils/helpers');

const router = express.Router();

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// ---------- 今日营业统计（放在 /:id 之前注册，避免被当成 id） ----------
router.get('/stats/today', (req, res) => {
  const date = req.query.date || localDateStr();
  const row = db.prepare(
    `SELECT COUNT(*)          AS bill_count,
            IFNULL(SUM(pay_amount), 0)   AS total_pay,
            IFNULL(SUM(table_fee), 0)    AS total_table_fee,
            IFNULL(SUM(goods_fee), 0)    AS total_goods_fee,
            IFNULL(SUM(discount), 0)     AS total_discount
       FROM bills WHERE bill_date = ?`
  ).get(date);

  // 按支付方式分组统计（现金/微信/支付宝各收了多少）
  const byMethod = db.prepare(
    `SELECT pay_method, COUNT(*) AS cnt, IFNULL(SUM(pay_amount),0) AS amount
       FROM bills WHERE bill_date = ? GROUP BY pay_method`
  ).all(date);

  res.json({ date, ...row, by_method: byMethod });
});

// ---------- 账单列表（按天查询，默认今天；date=all 查全部） ----------
router.get('/', (req, res) => {
  const { date = localDateStr(), limit = 100, offset = 0 } = req.query;

  let sql = 'SELECT * FROM bills';
  const args = [];
  if (date !== 'all') { sql += ' WHERE bill_date = ?'; args.push(date); }
  sql += ` ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 100, 500)} OFFSET ${Number(offset) || 0}`;

  const list = db.prepare(sql).all(...args);
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
