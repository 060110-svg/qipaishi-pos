/**
 * 新订单提醒接口（店长后台每隔几秒轮询一次）
 * 用法：GET /api/notify/new-orders?since_id=12
 *   since_id = 店长端已经见过的最大订单 id（首次传 0 或当前最大 id）
 * 返回：id 大于 since_id 的新订单（含明细、桌台名）
 *
 * 说明：轮询实现最简单可靠，局域网内延迟≈轮询间隔。
 * 若以后想要"秒级推送"，可换成 WebSocket（socket.io）或 SSE，前端改动只在 admin.js 的 pollNewOrders()。
 */
const db = require('../db');

module.exports = function newOrdersHandler(req, res) {
  const sinceId = Number(req.query.since_id) || 0;

  const orders = db.prepare(
    `SELECT o.*, t.name AS table_name
       FROM orders o JOIN tables t ON t.id = o.table_id
      WHERE o.id > ? AND o.status = 'pending'
      ORDER BY o.id`
  ).all(sinceId);

  // 附带每个订单的商品明细，方便店长直接在提醒里看到点了什么
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = itemsStmt.all(o.id);

  // 当前库里最大订单 id（原样返回：前端用它推进基线；
  // 若比前端记录的基线还小，说明数据库被重置过，前端会自动下调基线）
  const latest = db.prepare('SELECT IFNULL(MAX(id), 0) AS m FROM orders').get().m;

  res.json({ orders, latest_id: latest });
};
