/**
 * 店长登录鉴权（轻量实现：内存令牌，重启服务后需重新登录）
 * - POST /api/login  { password }  → { token }
 * - 之后管理接口请求头带上  x-admin-token: <token>
 * - 登录防爆破：IP 级别失败锁定（默认 10 次错误锁 15 分钟）
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

// ===== 登录失败跟踪（内存，重启清空 · 联网盘容量分摊攻面） =====
// 结构：IP → { count, lastFail, lockedUntil }
const loginFailures = new Map();
const LS = config.loginSecurity;

// 清理过期记录，防止长时间运行后内存膨胀（hash 不超过 ~2000 条即安全）
function cleanFailures() {
  const now = Date.now();
  if (loginFailures.size > 500) {
    for (const [ip, f] of loginFailures) {
      if (now > f.lastFail + LS.windowMinutes * 60000) loginFailures.delete(ip);
    }
  }
}

// 获取调用方 IP（优先 nginx 反代透传的 X-Forwarded-For）
function clientIP(req) {
  const ff = req.get('x-forwarded-for');
  return (ff ? ff.split(',')[0].trim() : req.ip) || 'unknown';
}

/**
 * 启动时检查：如果没配环境变量且密码仍是默认值，打印醒目警告。
 * 由 index.js 在服务启动后调用。
 */
function checkPasswordStrength() {
  if (!process.env.ADMIN_PASSWORD && config.adminPassword === '123456') {
    console.warn('');
    console.warn('  ╔══════════════════════════════════════════════════════════╗');
    console.warn('  ║  ⚠ 安全警告：店长后台密码仍是默认值 123456               ║');
    console.warn('  ║    公网部署前请务必设置环境变量 ADMIN_PASSWORD 为强密码   ║');
    console.warn('  ║    Linux/Mac: export ADMIN_PASSWORD="你的强密码"           ║');
    console.warn('  ║    Windows:    set ADMIN_PASSWORD=你的强密码                ║');
    console.warn('  ╚══════════════════════════════════════════════════════════╝');
    console.warn('');
  }
}

// 登录接口
router.post('/login', (req, res) => {
  cleanFailures();
  const ip = clientIP(req);
  const f = loginFailures.get(ip) || { count: 0, lastFail: 0, lockedUntil: 0 };
  const now = Date.now();

  // 1）还在锁定期？
  if (now < f.lockedUntil) {
    const remain = Math.ceil((f.lockedUntil - now) / 60000);
    return res.status(429).json({
      error: `尝试次数过多，请 ${remain} 分钟后再试`,
    });
  }

  // 2）过期窗口 → 重置计数
  if (now - f.lastFail > LS.windowMinutes * 60000) {
    f.count = 0;
  }

  // 3）密码校验
  const { password } = req.body || {};
  if (password !== config.adminPassword) {
    f.count += 1;
    f.lastFail = now;
    if (f.count >= LS.maxAttempts) {
      f.lockedUntil = now + LS.lockoutMinutes * 60000;
    }
    loginFailures.set(ip, f);
    const remain = Math.max(0, LS.maxAttempts - f.count);
    return res.status(401).json({
      error: f.lockedUntil
        ? `错误次数过多，锁定 ${LS.lockoutMinutes} 分钟`
        : `密码错误，还可尝试 ${remain} 次`,
    });
  }

  // 4）登录成功 → 清除失败记录
  loginFailures.delete(ip);
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

module.exports = { router, requireAdmin, optionalAdmin, checkPasswordStrength };
