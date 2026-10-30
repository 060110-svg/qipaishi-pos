/**
 * 桌费计算 —— 计费规则集中在这里，想改规则只改这个文件
 *
 * 默认规则：
 *   实际时长(分钟) → 折算小时 → 不足 1 小时按 1 小时计（向上取整）
 *   计费时长 = max(桌台的最低消费时长 min_hours, 取整后的小时数)
 *   桌费     = 计费时长 × hourly_rate
 */
const config = require('../config');
const { round2 } = require('./helpers');

/**
 * @param {string} openedAt 开台时间（ISO 字符串）
 * @param {object} table    桌台记录 { hourly_rate, min_hours }
 * @param {Date}   [endAt]  结束时间，默认当前时间（结桌/预览共用）
 * @returns {{minutes:number, billedHours:number, hourlyRate:number, tableFee:number}}
 */
function calcTableFee(openedAt, table, endAt = new Date()) {
  const start = new Date(openedAt).getTime();
  const minutes = Math.max(0, Math.round((endAt.getTime() - start) / 60000));

  let billedHours;
  if (config.billing.roundUpToHour) {
    // 不足 1 小时按 1 小时计
    billedHours = Math.max(1, Math.ceil(minutes / 60));
  } else {
    // 按实际分钟折算（保留 2 位小数）
    billedHours = round2(minutes / 60);
  }
  // 最低消费时长兜底
  billedHours = Math.max(billedHours, Number(table.min_hours) || 0);

  return {
    minutes,
    billedHours,
    hourlyRate: Number(table.hourly_rate),
    tableFee: round2(billedHours * Number(table.hourly_rate)),
  };
}

module.exports = { calcTableFee };
