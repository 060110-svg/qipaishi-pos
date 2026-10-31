/**
 * 计费规则单元测试 —— 覆盖 pricing.js 的各种边界
 * 运行：npm test
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const config = require('../server/config');
const { calcTableFee } = require('../server/utils/pricing');

// 辅助：构造"开了 N 分钟"的桌台，返回 { openedAt, table }
function scenario(minutesAgo, opts = {}) {
  return {
    openedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    table: {
      hourly_rate: opts.hourlyRate ?? 20,
      min_hours: opts.minHours ?? 1,
    },
  };
}

describe('calcTableFee — 向上取整模式 (默认)', () => {
  let saved;
  before(() => { saved = config.billing.roundUpToHour; config.billing.roundUpToHour = true; });
  after(() => { config.billing.roundUpToHour = saved; });

  it('整 1 小时 → 1 小时，桌费 = 20', () => {
    const { openedAt, table } = scenario(60);
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 1);
    assert.strictEqual(fee.tableFee, 20);
  });

  it('1 小时 1 分钟 → 2 小时（不足 1 小时按 1 小时计）', () => {
    const { openedAt, table } = scenario(61);
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 2);
    assert.strictEqual(fee.tableFee, 40);
  });

  it('刚好 2 小时 → 2 小时', () => {
    const { openedAt, table } = scenario(120);
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 2);
    assert.strictEqual(fee.tableFee, 40);
  });

  it('刚开台 0 分钟 → 最低 1 小时', () => {
    const { openedAt, table } = scenario(0);
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 1);
    assert.strictEqual(fee.tableFee, 20);
  });

  it('最低消费 3 小时兜底（10 分钟也按 3 小时计）', () => {
    const { openedAt, table } = scenario(10, { minHours: 3 });
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 3);
    assert.strictEqual(fee.tableFee, 60);
  });

  it('高费率 50 元/小时 × 2 小时 = 100', () => {
    const { openedAt, table } = scenario(72, { hourlyRate: 50 });
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 2);
    assert.strictEqual(fee.tableFee, 100);
  });

  it('费率 0 → 桌费为 0', () => {
    const { openedAt, table } = scenario(90, { hourlyRate: 0 });
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 2);
    assert.strictEqual(fee.tableFee, 0);
  });
});

describe('calcTableFee — 按实际分钟折算模式', () => {
  let saved;
  before(() => { saved = config.billing.roundUpToHour; config.billing.roundUpToHour = false; });
  after(() => { config.billing.roundUpToHour = saved; });

  it('30 分钟 → 0.5 小时，桌费 = 10（min_hours=0 时按实际折算）', () => {
    const { openedAt, table } = scenario(30, { minHours: 0 });
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 0.5);
    assert.strictEqual(fee.tableFee, 10);
  });

  it('90 分钟 → 1.5 小时，桌费 = 30', () => {
    const { openedAt, table } = scenario(90);
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 1.5);
    assert.strictEqual(fee.tableFee, 30);
  });

  it('最低消费下限仍然生效（5 分钟 / min_hours=2 → 2 小时）', () => {
    const { openedAt, table } = scenario(5, { minHours: 2 });
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 2);
    assert.strictEqual(fee.tableFee, 40);
  });

  it('15 分钟 → 0.25 小时（min_hours=0 时按实际折算）', () => {
    const { openedAt, table } = scenario(15, { minHours: 0, hourlyRate: 40 });
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 0.25);
    assert.strictEqual(fee.tableFee, 10);
  });

  it('30 分钟但 min_hours 默认 1 → 仍按最低 1 小时计', () => {
    const { openedAt, table } = scenario(30); // min_hours 默认 1
    const fee = calcTableFee(openedAt, table);
    assert.strictEqual(fee.billedHours, 1);
    assert.strictEqual(fee.tableFee, 20);
  });
});

describe('calcTableFee 边界情况', () => {
  it('极端长期 → 不溢出', () => {
    const { openedAt, table } = scenario(23 * 60);
    const fee = calcTableFee(openedAt, table);
    assert.ok(fee.minutes > 0);
    assert.ok(fee.tableFee > 0);
  });

  it('min_hours 为 0 时按实际时长不计入最低消费', () => {
    const saved = config.billing.roundUpToHour;
    config.billing.roundUpToHour = false;
    try {
      const { openedAt, table } = scenario(30, { minHours: 0, hourlyRate: 10 });
      const fee = calcTableFee(openedAt, table);
      assert.strictEqual(fee.billedHours, 0.5);
      assert.strictEqual(fee.tableFee, 5);
    } finally {
      config.billing.roundUpToHour = saved;
    }
  });
});