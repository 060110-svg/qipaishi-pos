/**
 * 服务入口 —— 启动: npm start，然后访问 http://localhost:3000
 *   /            导航页（选择进入店长后台或顾客点单）
 *   /admin/      店长后台（桌台、商品、订单、账单）
 *   /mobile/     顾客移动端（选桌、下单）；带参数 /mobile/?table=A1 可直接定位桌台（用于二维码）
 */
const express = require('express');
const path = require('path');
const config = require('./config');
const { router: authRouter, requireAdmin, optionalAdmin } = require('./auth');

const app = express();

// ---------- 基础中间件 ----------
app.use(express.json());                          // 解析 JSON 请求体
app.use(express.static(path.join(__dirname, '..', 'public'))); // 静态页面

// ---------- 登录鉴权 ----------
app.use('/api', authRouter);

// ---------- 业务路由 ----------
// 桌台：查询/开台对顾客开放；增删改、结桌需要店长权限（路由内部处理）
app.use('/api/tables', optionalAdmin, require('./routes/tables'));

// 商品：顾客只能看上架商品；增删改需要店长权限（路由内部处理）
app.use('/api/products', optionalAdmin, require('./routes/products'));

// 订单：顾客可按桌台下单/查询；确认/取消需要店长权限（路由内部处理）
app.use('/api/orders', optionalAdmin, require('./routes/orders'));

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
  console.log('==================================================');
  console.log('  棋牌室收银下单系统已启动');
  console.log(`  导航页    : http://localhost:${config.port}/`);
  console.log(`  店长后台  : http://localhost:${config.port}/admin/   (默认密码 ${config.adminPassword})`);
  console.log(`  顾客点单  : http://localhost:${config.port}/mobile/  (手机需与电脑同一WiFi, 用 http://<电脑IP>:${config.port}/mobile/ 访问)`);
  console.log('==================================================');
});
