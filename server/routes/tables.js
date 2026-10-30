/**
 * 桌台管理 API
 * 顾客端可用：查询桌台、开台（自助开台）
 * 店长端专用：新增/修改/删除桌台、结桌、账单预览
 */
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { round2, nowISO, localDateStr, genNo } = require('../utils/helpers');
const { calcTableFee } = require('../utils/pricing');
const wx = require('../wx');

const router = express.Router();

// 允许的房型（想加新房型：这里加一项，前端 admin.js 的 ROOM_TYPES 同步加）
const ROOM_TYPES = ['standard', 'deluxe', 'vip'];
// 允许的支付方式（预留：接入在线支付后可扩展）
const PAY_METHODS = ['cash', 'wechat', 'alipay', 'card'];

// 构造带状态码的错误，交给全局错误处理
function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// ---------- 查询全部桌台（公开：顾客选桌、店长看板都用它） ----------
router.get('/', (req, res) => {
  const list = db.prepare('SELECT * FROM tables ORDER BY name').all();
  res.json(list);
});

// ---------- 查询单个桌台（公开） ----------
router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) throw httpErr(404, '桌台不存在');
  res.json(t);
});

// ---------- 新增桌台（店长） ----------
router.post('/', requireAdmin, (req, res) => {
  const { name, room_type = 'standard', hourly_rate, min_hours = 1, remark = '' } = req.body || {};
  if (!name || !String(name).trim()) throw httpErr(400, '桌台名不能为空');
  if (!ROOM_TYPES.includes(room_type)) throw httpErr(400, '房型不合法');
  if (!(Number(hourly_rate) > 0)) throw httpErr(400, '每小时费率必须大于 0');
  if (!(Number(min_hours) >= 0)) throw httpErr(400, '最低消费时长不能为负数');

  const exists = db.prepare('SELECT id FROM tables WHERE name = ?').get(String(name).trim());
  if (exists) throw httpErr(400, `桌台名 "${name}" 已存在`);

  const info = db.prepare(
    `INSERT INTO tables (name, room_type, hourly_rate, min_hours, status, remark, created_at)
     VALUES (?, ?, ?, ?, 'idle', ?, ?)`
  ).run(String(name).trim(), room_type, Number(hourly_rate), Number(min_hours), remark, nowISO());

  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- 修改桌台（店长） ----------
// 注意：使用中的桌台改费率，会按新费率结桌（费率在结桌时才做快照）
router.put('/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) throw httpErr(404, '桌台不存在');

  const { name = t.name, room_type = t.room_type, hourly_rate = t.hourly_rate,
          min_hours = t.min_hours, remark = t.remark } = req.body || {};
  if (!String(name).trim()) throw httpErr(400, '桌台名不能为空');
  if (!ROOM_TYPES.includes(room_type)) throw httpErr(400, '房型不合法');
  if (!(Number(hourly_rate) > 0)) throw httpErr(400, '每小时费率必须大于 0');
  if (!(Number(min_hours) >= 0)) throw httpErr(400, '最低消费时长不能为负数');

  const dup = db.prepare('SELECT id FROM tables WHERE name = ? AND id != ?').get(String(name).trim(), t.id);
  if (dup) throw httpErr(400, `桌台名 "${name}" 已被其他桌台使用`);

  db.prepare(
    `UPDATE tables SET name=?, room_type=?, hourly_rate=?, min_hours=?, remark=? WHERE id=?`
  ).run(String(name).trim(), room_type, Number(hourly_rate), Number(min_hours), remark, t.id);

  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(t.id));
});

// ---------- 删除桌台（店长，仅"空闲且无历史订单"的桌台可删） ----------
router.delete('/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) throw httpErr(404, '桌台不存在');
  if (t.status === 'occupied') throw httpErr(400, '桌台使用中，请先结桌再删除');
  // 有历史订单的桌台不允许删除（外键关联），否则订单会失去归属；建议改名或停用
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE table_id = ?').get(t.id).c;
  if (orderCount > 0) {
    throw httpErr(400, `该桌台有 ${orderCount} 笔历史订单，不能删除；如不再使用可改名或忽略`);
  }
  db.prepare('DELETE FROM tables WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ---------- 开台（公开：店长可代开，顾客也可自助开台） ----------
router.post('/:id/open', (req, res) => {
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) throw httpErr(404, '桌台不存在');
  if (t.status === 'occupied') throw httpErr(400, '该桌台已在使用中');

  const { customer_name = '', remark = '' } = req.body || {};
  // remark 写入 session_remark（本次开台备注）；店长维护的固定备注 t.remark 不受影响
  // openid：小程序静默登录后带入（匿名/H5 为空），用于防刷追溯
  db.prepare(
    `UPDATE tables SET status='occupied', opened_at=?, customer_name=?, session_remark=?, openid=? WHERE id=?`
  ).run(nowISO(), String(customer_name).slice(0, 30), String(remark).slice(0, 100),
    wx.openidOf(req.get('x-wx-token')), t.id);

  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(t.id));
});

// ---------- 账单预览（店长）：结桌前先看金额明细 ----------
router.get('/:id/bill-preview', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) throw httpErr(404, '桌台不存在');
  if (t.status !== 'occupied') throw httpErr(400, '桌台未开台，无需结账');

  const fee = calcTableFee(t.opened_at, t);
  // 只有"已确认"的订单计入商品费（待处理的订单结账前应先确认或取消）
  const orders = db.prepare(
    `SELECT * FROM orders WHERE table_id=? AND status='confirmed' ORDER BY created_at`
  ).all(t.id);
  const goodsFee = round2(orders.reduce((s, o) => s + o.total_amount, 0));
  const pendingCount = db.prepare(
    `SELECT COUNT(*) c FROM orders WHERE table_id=? AND status='pending'`
  ).get(t.id).c;

  res.json({
    table: t,
    ...fee,                                   // minutes / billedHours / hourlyRate / tableFee
    goodsFee,
    total: round2(fee.tableFee + goodsFee),   // 应收合计
    orders,
    pendingCount,                             // >0 时前端提醒店长先处理待确认订单
  });
});

// ---------- 结桌（店长）：算钱 → 生成账单 → 订单并入账单 → 桌台回到空闲 ----------
router.post('/:id/close', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!t) throw httpErr(404, '桌台不存在');
  if (t.status !== 'occupied') throw httpErr(400, '桌台未开台');

  const { discount = 0, pay_method = 'cash', remark = '' } = req.body || {};
  if (!PAY_METHODS.includes(pay_method)) throw httpErr(400, '支付方式不合法');

  // 有待处理订单时禁止结桌：否则订单会被永久遗留（桌台已空闲）且未计入账单
  const pendingCount = db.prepare(
    `SELECT COUNT(*) AS c FROM orders WHERE table_id = ? AND status = 'pending'`
  ).get(t.id).c;
  if (pendingCount > 0) {
    throw httpErr(400, `该桌还有 ${pendingCount} 笔待处理订单，请先到「订单管理」确认或取消后再结桌`);
  }

  // 整个结桌过程放在一个事务里，任何一步失败都会回滚
  const result = db.transaction(() => {
    const fee = calcTableFee(t.opened_at, t);

    const orders = db.prepare(
      `SELECT * FROM orders WHERE table_id=? AND status='confirmed'`
    ).all(t.id);
    const goodsFee = round2(orders.reduce((s, o) => s + o.total_amount, 0));

    const total = round2(fee.tableFee + goodsFee);
    const disc = Math.min(Math.max(0, Number(discount) || 0), total); // 优惠不能超过应收
    const payAmount = round2(total - disc);

    // 账单备注 = 结桌备注 + 本次开台备注（合并后 session_remark 随结桌清空）
    const billRemark = [String(remark || ''), t.session_remark && `开台备注：${t.session_remark}`]
      .filter(Boolean).join('；');

    // 写入账单（费率、桌名等都做快照，之后改价不影响历史账单）
    const billInfo = db.prepare(
      `INSERT INTO bills
        (bill_no, bill_date, table_id, table_name, room_type, customer_name,
         opened_at, closed_at, duration_minutes, billed_hours, hourly_rate,
         table_fee, goods_fee, total_amount, discount, pay_amount,
         pay_method, pay_status, remark, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'paid', ?, ?)`
    ).run(
      genNo('ZD'), localDateStr(), t.id, t.name, t.room_type, t.customer_name || '',
      t.opened_at, nowISO(), fee.minutes, fee.billedHours, fee.hourlyRate,
      fee.tableFee, goodsFee, total, disc, payAmount,
      pay_method, billRemark, nowISO()
    );
    const billId = billInfo.lastInsertRowid;

    // 已确认订单 → 标记为已结账并关联账单
    const markSettled = db.prepare(`UPDATE orders SET status='settled', bill_id=? WHERE id=?`);
    for (const o of orders) markSettled.run(billId, o.id);

    // 桌台回到空闲（只清空本次会话字段，店长维护的 remark 保留）
    db.prepare(
      `UPDATE tables SET status='idle', opened_at=NULL, customer_name=NULL, session_remark=NULL, openid=NULL WHERE id=?`
    ).run(t.id);

    return db.prepare('SELECT * FROM bills WHERE id=?').get(billId);
  })();

  res.json({ ok: true, bill: result });
});

module.exports = router;
