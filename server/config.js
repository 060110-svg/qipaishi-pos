/**
 * 全局配置 —— 需要修改的地方都集中在这里
 */
const path = require('path');

module.exports = {
  // 服务端口：启动后访问 http://localhost:3000
  port: process.env.PORT || 3000,

  // 店长后台登录密码（上线前请务必修改！）
  adminPassword: process.env.ADMIN_PASSWORD || '123456',

  // 登录令牌有效期（小时）
  tokenTTLHours: 12,

  // SQLite 数据库文件位置（首次启动自动创建）
  dbFile: path.join(__dirname, '..', 'db', 'data.db'),

  // 桌费计费规则（默认值，每张桌台可在后台单独设置覆盖）：
  //   计费时长 = max(最低消费时长, 实际时长向上取整到整小时)
  //   桌费     = 计费时长 × 每小时费率
  billing: {
    roundUpToHour: true, // true=不足1小时按1小时计；false=按实际分钟折算
  },

  // ===== 支付扩展预留位 =====
  // 目前只做金额计算与订单/账单记录，pay_method 仅为记账字段。
  // 将来接入微信/支付宝时：
  //   1. 在 server/routes/pay.js 新建支付路由（下单预支付、回调通知）
  //   2. 回调成功后把 bills.pay_status 从 'unpaid' 改为 'paid'，写入 transaction_id
  //   3. 在 server/index.js 里 app.use('/api/pay', require('./routes/pay'))
  payment: {
    enabled: false, // 预留开关：接入在线支付后改为 true
  },
};
