/**
 * 工具函数单元测试 —— helpers.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { round2, nowISO, localDateStr, genNo } = require('../server/utils/helpers');

describe('round2', () => {
  it('整数不丢失精度', () => {
    assert.strictEqual(round2(100), 100);
  });

  it('两位小数不变', () => {
    assert.strictEqual(round2(12.34), 12.34);
  });

  it('浮点加法类误差被修正', () => {
    // 0.1 + 0.2 = 0.30000000000000004
    assert.strictEqual(round2(0.1 + 0.2), 0.3);
  });

  it('超过两位小数被四舍五入到两位', () => {
    assert.strictEqual(round2(1.234), 1.23);
    // 1.235 在 IEEE754 双精度下实际是 1.235000000000000097，进位为 1.24
    assert.strictEqual(round2(1.235), 1.24);
    assert.strictEqual(round2(1.236), 1.24);
  });

  it('负数保留两位', () => {
    assert.strictEqual(round2(-5.678), -5.68);
  });

  it('零值', () => {
    assert.strictEqual(round2(0), 0);
  });
});

describe('localDateStr', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    const d = new Date('2026-10-31T12:00:00Z');
    const s = localDateStr(d);
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('无参数时返回今天本地日期', () => {
    const s = localDateStr();
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    assert.strictEqual(s, expected);
  });
});

describe('nowISO', () => {
  it('返回 ISO 8601 字符串', () => {
    const s = nowISO();
    assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('返回值在前后 2 秒内', () => {
    const before = Date.now();
    const s = nowISO();
    const after = Date.now();
    const ts = new Date(s).getTime();
    assert.ok(ts >= before - 100 && ts <= after + 100);
  });
});

describe('genNo', () => {
  it('以给定前缀开头', () => {
    const no = genNo('DD');
    assert.ok(no.startsWith('DD'));
  });

  it('格式：前缀 + 17位时间戳 + "-" + 3位随机数', () => {
    const no = genNo('ZD');
    assert.match(no, /^ZD\d{17}-\d{3}$/);
  });

  it('不同前缀互不影响', () => {
    assert.ok(genNo('AA').startsWith('AA'));
    assert.ok(genNo('XYZ').startsWith('XYZ'));
  });
});