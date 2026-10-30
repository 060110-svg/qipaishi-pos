/**
 * 数据库备份脚本 —— 用 cron / 计划任务定时执行
 *   流程：WAL 合并回主库 → 复制 data.db 到 backups/ → 只保留最近 N 份
 *   Linux cron 示例（每天凌晨 4 点）：
 *     0 4 * * * cd /opt/qipaishi-pos && node scripts/backup-db.js >> backups/backup.log 2>&1
 *   可选环境变量：BACKUP_DIR（备份目录）、BACKUP_KEEP（保留份数，默认 14）
 *   建议备份目录再同步到异地（ossutil/rclone/网盘），防止整机丢失
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const dbFile = path.join(root, 'db', 'data.db');
const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 14);

fs.mkdirSync(backupDir, { recursive: true });

// 先把 WAL 日志合并回主文件，保证复制的单文件是完整一致的
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHMM
const target = path.join(backupDir, `data-${stamp}.db`);
fs.copyFileSync(dbFile, target);

// 清理旧备份，只留最近 KEEP 份
const files = fs.readdirSync(backupDir).filter((f) => /^data-\d{12}\.db$/.test(f)).sort();
while (files.length > KEEP) fs.unlinkSync(path.join(backupDir, files.shift()));

console.log(`[backup] 已备份到 ${target}（${(fs.statSync(target).size / 1024).toFixed(1)} KB），保留 ${Math.min(files.length + 1, KEEP)} 份`);
