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

  // 登录安全：防爆破
  loginSecurity: {
    maxAttempts: 10,             // 连续输错次数上限
    lockoutMinutes: 15,          // 锁定时长（分钟）
    windowMinutes: 10,           // 失败计数窗口（分钟，此窗口内连续错误才累计）
  },

  // SQLite 数据库文件位置（首次启动自动创建）
  dbFile: path.join(__dirname, '..', 'db', 'data.db'),

  // 桌费计费规则（默认值，每张桌台可在后台单独设置覆盖）：
  //   计费时长 = max(最低消费时长, 实际时长向上取整到整小时)
  //   桌费     = 计费时长 × 每小时费率
  billing: {
    roundUpToHour: true, // true=不足1小时按1小时计；false=按实际分钟折算
  },

  // ===== 微信小程序对接（上线必需；局域网试用可留空，前端会自动降级为匿名） =====
  // appId 见 miniprogram/project.config.json；appSecret 在 mp.weixin.qq.com
  // 「开发管理 → 开发设置」生成，只通过环境变量 WX_SECRET 注入服务器，切勿写进代码库
  wx: {
    appId: process.env.WX_APPID || 'wx77a1a1cd8dfa9da0',
    appSecret: process.env.WX_SECRET || '',
  },

  // 企业微信群机器人 Webhook：新订单实时推送（留空=不推送，网页轮询提醒不受影响）
  webhookUrl: process.env.WEBHOOK_URL || '',

  // 限流（防恶意刷接口）：全局每分钟上限 / 顾客写接口每分钟上限
  rateLimit: { globalPerMin: 300, writePerMin: 20 },

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
