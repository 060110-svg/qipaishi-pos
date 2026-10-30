/**
 * 通用工具函数
 */

// 金额保留两位小数（避免 0.1+0.2 之类的浮点误差）
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// 当前时间的 ISO 字符串（统一用它存时间，前端 toLocaleString 显示为本地时区）
function nowISO() {
  return new Date().toISOString();
}

// 本地日期字符串 YYYY-MM-DD（账单按天查询用）
function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 生成单号：前缀 + 时间(含毫秒) + 随机数，如 DD20261030123001512-483
// 精确到毫秒 + 3位随机数，同毫秒碰撞概率约 1/900，实际可忽略；万一撞 UNIQUE 约束事务会安全回滚
function genNo(prefix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    String(d.getMilliseconds()).padStart(3, '0');
  return `${prefix}${ts}-${Math.floor(Math.random() * 900 + 100)}`;
}

module.exports = { round2, nowISO, localDateStr, genNo };
