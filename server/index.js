/**
 * 服务入口 —— 启动: npm start，然后访问 http://localhost:3000
 *   /            导航页（选择进入店长后台或顾客点单）
 *   /admin/      店长后台（桌台、商品、订单、账单）
 *   /mobile/     顾客移动端（选桌、下单）；带参数 /mobile/?table=A1 可直接定位桌台（用于二维码）
 */
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { router: authRouter, requireAdmin, optionalAdmin, checkPasswordStrength } = require('./auth');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);  // nginx 反代场景：限流按 X-Forwarded-For 真实 IP 计；直连时不受影响

const startTime = Date.now(); // 服务启动时间，健康检查用

// ---------- 基础中间件 ----------
// helmet 安全头；CSP 放开内联脚本——admin/mobile 大量使用 inline onclick 架构，
// 默认 CSP(script-src-attr 'none') 会让所有按钮失效。其余保护（nosniff/帧防护等）保留。
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'unsafe-inline'"],
    },
  },
}));
app.use(express.json({ limit: '100kb' }));         // 解析 JSON 请求体（限制大小防滥用）
app.use(express.static(path.join(__dirname, '..', 'public'))); // 静态页面

// ---------- 限流（防恶意刷接口；店长请求与 GET 查询不计入写限流） ----------
const skipAdmin = (req) => Boolean(req.isAdmin);
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.globalPerMin,
  standardHeaders: true, legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
}));
// 登录接口专用限流：5 次/分/IP，防在线爆破（锁定期逻辑在 auth.js）
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});
app.use('/api/login', loginLimiter);
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.writePerMin,
  skip: (req) => req.method === 'GET' || skipAdmin(req),
  standardHeaders: true, legacyHeaders: false,
  message: { error: '操作过于频繁，请稍后再试' },
});

// ---------- 登录鉴权 ----------
app.use('/api', authRouter);

// ---------- 健康检查（公开，接 uptime 监控用） ----------
app.get('/api/health', (req, res) => {
  let dbOk = false;
  try {
    dbOk = Boolean(db.prepare('SELECT 1 AS ok').get());
  } catch (_) { /* 数据库异常时 dbOk 保持 false */ }
  res.json({
    ok: dbOk,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    db: dbOk ? 'ok' : 'error',
    version: '1.0.0',
  });
});

// ---------- 业务路由 ----------
// 桌台：查询/开台对顾客开放；增删改、结桌需要店长权限（路由内部处理）
app.use('/api/tables', optionalAdmin, writeLimiter, require('./routes/tables'));

// 商品：顾客只能看上架商品；增删改需要店长权限（路由内部处理）
app.use('/api/products', optionalAdmin, writeLimiter, require('./routes/products'));

// 订单：顾客可按桌台下单/查询；确认/取消需要店长权限（路由内部处理）
app.use('/api/orders', optionalAdmin, writeLimiter, require('./routes/orders'));

// 微信：静默登录（公开）/ 每桌小程序码（店长）
app.use('/api/wx', require('./routes/wx'));

// 新订单提醒（店长轮询）
app.get('/api/notify/new-orders', requireAdmin, require('./routes/notify'));

// 账单：全部需要店长权限
app.use('/api/bills', requireAdmin, require('./routes/bills'));

// ---------- 404 与统一错误处理 ----------
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在: ' + req.method + ' ' + req.path }));

app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

// ---------- 启动 ----------
app.listen(config.port, () => {
  checkPasswordStrength();
  console.log('==================================================');
  console.log('  棋牌室收银下单系统已启动');
  console.log(`  导航页    : http://localhost:${config.port}/`);
  console.log(`  店长后台  : http://localhost:${config.port}/admin/   (默认密码 ${config.adminPassword})`);
  console.log(`  顾客点单  : http://localhost:${config.port}/mobile/  (手机需与电脑同一WiFi, 用 http://<电脑IP>:${config.port}/mobile/ 访问)`);
  console.log(`  健康检查  : http://localhost:${config.port}/api/health`);
  console.log('==================================================');
});
