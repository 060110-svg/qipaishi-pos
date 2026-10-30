/**
 * 微信相关接口
 * - POST /api/wx/login            公开　顾客静默登录 {code} → {ok, token}；未配置微信时返回 {ok:false}
 * - GET  /api/wx/table-qrcode     店长　每桌小程序码 PNG，?name=A1&env=release|trial
 */
const express = require('express');
const wx = require('../wx');
const { requireAdmin } = require('../auth');

const router = express.Router();

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// Express 4 不会捕获 async handler 里的 throw（会变成未处理的 Promise 拒绝导致进程崩溃），
// 统一用 wrap 把拒绝转交给错误中间件
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post('/login', wrap(async (req, res) => {
  if (!wx.enabled()) return res.json({ ok: false, reason: '未配置微信对接（WX_SECRET），以匿名模式使用' });
  const { code } = req.body || {};
  if (!code) throw httpErr(400, '缺少微信登录 code');
  const { openid } = await wx.code2Session(code);
  res.json({ ok: true, token: wx.issueToken(openid) });
}));

router.get('/table-qrcode', requireAdmin, wrap(async (req, res) => {
  if (!wx.enabled()) {
    throw httpErr(503, '未配置微信对接：请在服务器设置环境变量 WX_APPID 与 WX_SECRET 后重启');
  }
  const name = String(req.query.name || '').trim();
  if (!name || name.length > 32) throw httpErr(400, '桌台名需为 1~32 个字符');
  const env = req.query.env === 'trial' ? 'trial' : req.query.env === 'develop' ? 'develop' : 'release';
  const buf = await wx.getTableQrcode(name, env);
  res.type('image/png').send(buf);
}));

module.exports = router;
