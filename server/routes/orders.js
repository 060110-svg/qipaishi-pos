/**
 * 订单 API（顾客下单 / 店长处理订单）
 * 顾客端：POST /api/orders 下单；GET /api/orders?table_id=x 查看本桌订单
 * 店长端：GET /api/orders 查全部；POST /:id/confirm 确认；POST /:id/cancel 取消
 *
 * 订单状态流转：pending(待处理) → confirmed(已确认) → settled(已结账，结桌时自动)
 *                     └────────→ cancelled(已取消)
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAdmin } = require('../auth');
const { round2, nowISO, genNo } = require('../utils/helpers');
const wx = require('../wx');

const router = express.Router();

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// 给订单附上商品明细和桌台名
function attachDetail(order) {
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const t = db.prepare('SELECT name FROM tables WHERE id = ?').get(order.table_id);
  order.table_name = t ? t.name : '（桌台已删除）';
  return order;
}

// ---------- 顾客下单（公开） ----------
// 请求体: { table_id, items: [{product_id, quantity}], remark }
router.post('/', (req, res) => {
  const { table_id, items, remark = '' } = req.body || {};

  if (!table_id) throw httpErr(400, '请选择桌台');
  if (!Array.isArray(items) || items.length === 0) throw httpErr(400, '请至少选购一件商品');

  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(table_id);
  if (!table) throw httpErr(404, '桌台不存在');
  if (table.status !== 'occupied') throw httpErr(400, '该桌台尚未开台，请先开台再下单');

  // 先按商品聚合数量：防止同一商品拆成多行、各自通过库存校验导致超卖
  const qtyMap = new Map();
  for (const it of items) {
    const qty = Number.parseInt(it.quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) throw httpErr(400, '商品数量必须是正整数');
    const pid = Number(it.product_id);
    qtyMap.set(pid, (qtyMap.get(pid) || 0) + qty);
  }

  // 在事务外校验并计算金额（读到的价格做快照写入订单）
  const getProd = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  let total = 0;
  for (const [pid, qty] of qtyMap) {
    const p = getProd.get(pid);
    if (!p || !p.is_active) throw httpErr(400, `商品不存在或已下架 (id=${pid})`);
    if (p.stock >= 0 && p.stock < qty) throw httpErr(400, `「${p.name}」库存不足（剩余 ${p.stock}）`);
    const subtotal = round2(p.price * qty);
    lines.push({ p, qty, subtotal });
    total = round2(total + subtotal);
  }

  // 事务：写订单 + 写明细 + 扣库存，一步失败全部回滚
  const openid = wx.openidOf(req.get('x-wx-token')); // 小程序静默登录归属（匿名/H5 为空）
  const order = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO orders (order_no, table_id, status, total_amount, remark, openid, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`
    ).run(genNo('DD'), table.id, total, String(remark).slice(0, 200), openid, nowISO());
    const orderId = info.lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, stock_deducted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // 带 stock >= ? 条件扣减，杜绝扣成负数（负数会被当成"不限量"）；受影响行数为 0 说明库存已被抢完
    const decStock = db.prepare(
      `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`
    );
    for (const { p, qty, subtotal } of lines) {
      const deducted = p.stock >= 0 ? 1 : 0; // stock=-1 不限量，不扣减
      insItem.run(orderId, p.id, p.name, p.price, qty, subtotal, deducted);
      if (deducted && decStock.run(qty, p.id, qty).changes !== 1) {
        throw httpErr(400, `「${p.name}」库存不足，请减少数量`); // 事务回滚
      }
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  })();

  pushWebhook(order, table); // 企业微信群推送（未配置或失败均不影响下单）
  // pushPlusNotify(order, table); // PushPlus 微信推送（已禁用，需实名认证）
  sendFeishuNotify(order, table); // 飞书群推送
  res.json(attachDetail(order));
});

// 新订单推送到企业微信群机器人（config.webhookUrl 留空=不推送）
function pushWebhook(order, table) {
  if (!config.webhookUrl) return;
  const items = db.prepare('SELECT product_name, quantity FROM order_items WHERE order_id = ?').all(order.id);
  const content = `🛎 新订单：桌台 ${table.name}（${order.order_no}）\n`
    + items.map((it) => `${it.product_name}×${it.quantity}`).join('、')
    + `\n合计 ${order.total_amount} 元`
    + (order.remark ? `\n备注：${order.remark}` : '');
  fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content } }),
  }).catch((e) => console.error('[webhook] 推送失败：', e.message));
}

// PushPlus 微信推送（config.pushplus.token 留空=不推送）
function pushPlusNotify(order, table) {
  if (!config.pushplus?.token) return;
  const items = db.prepare('SELECT product_name, quantity FROM order_items WHERE order_id = ?').all(order.id);
  const title = `🛎 新订单：桌台 ${table.name}`;
  const content = `### 订单号：${order.order_no}\n\n`
    + `**桌台：** ${table.name}\n\n`
    + `**商品明细：**\n`
    + items.map((it) => `- ${it.product_name} × ${it.quantity}`).join('\n')
    + `\n\n**合计金额：** ¥${order.total_amount}`
    + (order.remark ? `\n\n**备注：** ${order.remark}` : '')
    + `\n\n> 请及时处理订单`;
  fetch('http://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.pushplus.token,
      title,
      content,
      template: 'markdown',
    }),
  }).then(r => r.json()).then(d => {
    if (d.code !== 200) console.error('[pushplus] 推送失败：', d.msg);
  }).catch((e) => console.error('[pushplus] 推送失败：', e.message));
}

// 飞书群机器人推送（config.feishuWebhook 留空=不推送）
function sendFeishuNotify(order, table) {
  if (!config.feishuWebhook) return;
  const items = db.prepare('SELECT product_name, quantity FROM order_items WHERE order_id = ?').all(order.id);
  const content = `🛎 新订单提醒\n`
    + `桌台：${table.name}\n`
    + `订单号：${order.order_no}\n`
    + `商品明细：${items.map(it => `${it.product_name}×${it.quantity}`).join('、')}\n`
    + `合计金额：¥${order.total_amount}\n`
    + (order.remark ? `备注：${order.remark}\n` : '')
    + `请及时处理！`;
  fetch(config.feishuWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: content },
    }),
  }).then(r => r.json()).then(d => {
    if (d.code !== 0) {
      console.error('[feishu] 推送失败：', d.msg);
    } else {
      console.log('[feishu] 推送成功');
    }
  }).catch((e) => console.error('[feishu] 推送失败：', e.message));
}

// ---------- 查询订单列表 ----------
// 顾客：必须带 table_id，只能看自己桌的订单
// 店长：可看全部，支持 ?status=pending&table_id=1&limit=50
router.get('/', (req, res) => {
  const { table_id, status, limit = 50 } = req.query;

  if (!req.isAdmin && !table_id) {
    throw httpErr(403, '顾客端请带上 table_id 查询本桌订单');
  }
  const cond = [];
  const args = [];
  if (table_id) { cond.push('o.table_id = ?'); args.push(table_id); }
  if (status && status !== 'all') { cond.push('o.status = ?'); args.push(status); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const n = Math.min(Number(limit) || 50, 200);

  const orders = db.prepare(
    `SELECT o.*, t.name AS table_name FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     ${where} ORDER BY o.id DESC LIMIT ${n}`
  ).all(...args);

  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) {
    o.items = itemsStmt.all(o.id);
    if (!o.table_name) o.table_name = '（桌台已删除）';
  }
  res.json(orders);
});

// ---------- 查询单个订单（店长） ----------
router.get('/:id', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) throw httpErr(404, '订单不存在');
  res.json(attachDetail(o));
});

// ---------- 确认订单（店长）：确认后才计入结桌账单 ----------
router.post('/:id/confirm', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) throw httpErr(404, '订单不存在');
  if (o.status !== 'pending') throw httpErr(400, `当前状态(${o.status})不能确认，只有待处理订单可确认`);

  db.prepare(`UPDATE orders SET status='confirmed', confirmed_at=? WHERE id=?`).run(nowISO(), o.id);
  res.json(attachDetail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
});

// ---------- 取消订单（店长）：取消后把库存加回去 ----------
router.post('/:id/cancel', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) throw httpErr(404, '订单不存在');
  if (o.status !== 'pending' && o.status !== 'confirmed') {
    throw httpErr(400, `当前状态(${o.status})不能取消`);
  }

  db.transaction(() => {
    db.prepare(`UPDATE orders SET status='cancelled' WHERE id=?`).run(o.id);
    // 只恢复"下单时确实扣过库存"的明细（下单时不限量、之后被改为限量的商品不会凭空加库存）
    const items = db.prepare(
      'SELECT * FROM order_items WHERE order_id=? AND stock_deducted=1'
    ).all(o.id);
    const inc = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock >= 0');
    for (const it of items) inc.run(it.quantity, it.product_id);
  })();

  res.json(attachDetail(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
});

module.exports = router;
