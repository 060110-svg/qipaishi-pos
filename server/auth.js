/**
 * 店长登录鉴权（轻量实现：内存令牌，重启服务后需重新登录）
 * - POST /api/login  { password }  → { token }
 * - 之后管理接口请求头带上  x-admin-token: <token>
 * 说明：如需更强的安全性，可换用 JWT + HTTPS，本系统面向店内局域网使用从简。
 */
const crypto = require('crypto');
const express = require('express');
const config = require('./config');

const router = express.Router();

// token → 过期时间戳
const tokens = new Map();

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + config.tokenTTLHours * 3600 * 1000);
  return token;
}

// 校验 token 是否有效（顺便清理过期令牌）
function validToken(token) {
  if (!token) return false;
  const exp = tokens.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    tokens.delete(token);
    return false;
  }
  return true;
}

// 登录接口
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== config.adminPassword) {
    return res.status(401).json({ error: '密码错误' });
  }
  res.json({ token: issueToken() });
});

// 退出登录
router.post('/logout', (req, res) => {
  tokens.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

// 检查当前 token 是否仍然有效（前端刷新页面时调用）
router.get('/check', (req, res) => {
  res.json({ ok: validToken(req.headers['x-admin-token']) });
});

/**
 * Express 中间件：要求店长权限，否则返回 401
 */
function requireAdmin(req, res, next) {
  if (validToken(req.headers['x-admin-token'])) return next();
  res.status(401).json({ error: '请先登录店长后台' });
}

/**
 * Express 中间件：可选鉴权 —— 带了有效 token 就标记 req.isAdmin，不带也放行
 * （用于"顾客只能按桌查询、店长可查全部"这类接口）
 */
function optionalAdmin(req, res, next) {
  req.isAdmin = validToken(req.headers['x-admin-token']);
  next();
}

module.exports = { router, requireAdmin, optionalAdmin };
