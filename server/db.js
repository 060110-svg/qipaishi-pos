/**
 * 数据库连接与初始化 —— 使用 Node.js 内置 SQLite（node:sqlite），无需任何原生编译依赖
 * 要求 Node.js >= 22.5（推荐 22 LTS 或 24+）
 * - 首次启动：自动建表（schema.sql）并导入示例数据（seed.sql）
 * - 执行 `npm run reset-db`：删除数据库文件重建（清空所有数据，慎用！）
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// --reset 参数：删除旧数据库文件，下次启动重新建表+灌示例数据
if (process.argv.includes('--reset')) {
  if (fs.existsSync(config.dbFile)) {
    fs.unlinkSync(config.dbFile);
    console.log('[db] 已删除旧数据库:', config.dbFile);
  } else {
    console.log('[db] 数据库文件不存在，无需删除');
  }
  // 直接运行本文件（npm run reset-db）时到此为止
  if (require.main === module) process.exit(0);
}

// 确保 db 目录存在
fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

// 连接数据库（文件不存在会自动创建）
const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL');   // WAL 模式：读写并发更好
db.exec('PRAGMA foreign_keys = ON');    // 打开外键约束

// 建表（IF NOT EXISTS，可重复执行）
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
db.exec(schemaSql);

// 数据库为空时导入示例数据
const tableCount = db.prepare('SELECT COUNT(*) AS c FROM tables').get().c;
const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (tableCount === 0 && productCount === 0) {
  const seedSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
  db.exec(seedSql);
  console.log('[db] 首次启动：已导入示例桌台与商品数据');
}

/**
 * 事务辅助：模拟 better-sqlite3 的 db.transaction(fn)() 用法
 * 用法：db.transaction(() => { ...多条写操作... })()
 * 任何一步抛错都会整体回滚。
 */
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* 忽略回滚本身的异常 */ }
      throw err;
    }
  };
};

module.exports = db;
