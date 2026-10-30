/**
 * 商品管理 API（香烟/饮料/零食，完整增删改查）
 * 顾客端：只能查询"上架"商品
 * 店长端：增删改查全部商品
 */
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { nowISO } = require('../utils/helpers');

const router = express.Router();

// 允许的商品分类（想加新分类：这里加一项，前端 admin.js / mobile.js 的 CATEGORIES 同步加）
const CATEGORIES = ['cigarette', 'drink', 'snack', 'other'];

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// 校验商品字段，返回规范化后的对象
function parseProduct(body) {
  const { name, category = 'snack', price, stock = -1, is_active = 1, remark = '' } = body || {};
  if (!name || !String(name).trim()) throw httpErr(400, '商品名不能为空');
  if (!CATEGORIES.includes(category)) throw httpErr(400, '商品分类不合法');
  if (!(Number(price) >= 0)) throw httpErr(400, '单价必须是不小于 0 的数字');
  const stockNum = Number.parseInt(stock, 10);
  if (Number.isNaN(stockNum) || stockNum < -1) throw httpErr(400, '库存必须是 -1(不限量) 或 ≥0 的整数');
  return {
    name: String(name).trim(),
    category,
    price: Math.round(Number(price) * 100) / 100,
    stock: stockNum,
    is_active: is_active ? 1 : 0,
    remark: String(remark || ''),
  };
}

// ---------- 查询商品列表 ----------
// 顾客（未登录）：只返回上架商品；店长带 ?all=1 可看全部（含下架）
router.get('/', (req, res) => {
  const showAll = req.isAdmin && req.query.all === '1';
  const { category } = req.query;

  let sql = 'SELECT * FROM products';
  const cond = [];
  const args = [];
  if (!showAll) { cond.push('is_active = 1'); }
  if (category && category !== 'all') { cond.push('category = ?'); args.push(category); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY category, id';

  res.json(db.prepare(sql).all(...args));
});

// ---------- 查询单个商品 ----------
router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) throw httpErr(404, '商品不存在');
  res.json(p);
});

// ---------- 新增商品（店长） ----------
router.post('/', requireAdmin, (req, res) => {
  const p = parseProduct(req.body);
  const info = db.prepare(
    `INSERT INTO products (name, category, price, stock, is_active, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(p.name, p.category, p.price, p.stock, p.is_active, p.remark, nowISO());
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- 修改商品（店长）：改名/调价/改库存/上下架 ----------
router.put('/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!old) throw httpErr(404, '商品不存在');

  // 只覆盖请求里带了的字段，方便"单独改价格"这种场景
  const p = parseProduct({ ...old, ...req.body });
  db.prepare(
    `UPDATE products SET name=?, category=?, price=?, stock=?, is_active=?, remark=? WHERE id=?`
  ).run(p.name, p.category, p.price, p.stock, p.is_active, p.remark, old.id);

  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(old.id));
});

// ---------- 删除商品（店长） ----------
// 历史订单里存的是商品名/价格快照，删除商品不会影响已生成的订单和账单
router.delete('/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!old) throw httpErr(404, '商品不存在');
  db.prepare('DELETE FROM products WHERE id = ?').run(old.id);
  res.json({ ok: true });
});

module.exports = router;
