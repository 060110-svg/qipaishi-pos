-- ============================================================
-- 初始化示例数据（仅在数据库为空时自动导入）
-- 想改成自己店里的桌台/商品，直接改这里后执行 npm run reset-db，
-- 或登录店长后台在页面上增删改。
-- ============================================================

-- ---------- 桌台 ----------
INSERT INTO tables (name, room_type, hourly_rate, min_hours, status, created_at) VALUES
  ('A1', 'standard', 20, 1, 'idle', datetime('now')),
  ('A2', 'standard', 20, 1, 'idle', datetime('now')),
  ('A3', 'standard', 20, 1, 'idle', datetime('now')),
  ('A4', 'standard', 20, 1, 'idle', datetime('now')),
  ('B1', 'deluxe',   30, 2, 'idle', datetime('now')),
  ('B2', 'deluxe',   30, 2, 'idle', datetime('now')),
  ('C1', 'vip',      50, 3, 'idle', datetime('now')),
  ('C2', 'vip',      50, 3, 'idle', datetime('now'));

-- ---------- 商品（香烟） ----------
INSERT INTO products (name, category, price, stock, is_active, created_at) VALUES
  ('中华(软)',    'cigarette', 65, 50, 1, datetime('now')),
  ('利群(新版)',  'cigarette', 26, 50, 1, datetime('now')),
  ('芙蓉王(硬)',  'cigarette', 30, 50, 1, datetime('now')),
  ('玉溪(软)',    'cigarette', 23, 50, 1, datetime('now'));

-- ---------- 商品（饮料） ----------
INSERT INTO products (name, category, price, stock, is_active, created_at) VALUES
  ('可口可乐 330ml', 'drink', 5,  100, 1, datetime('now')),
  ('雪碧 330ml',     'drink', 5,  100, 1, datetime('now')),
  ('红牛 250ml',     'drink', 8,  100, 1, datetime('now')),
  ('矿泉水 550ml',   'drink', 2,  200, 1, datetime('now')),
  ('王老吉 310ml',   'drink', 6,  100, 1, datetime('now')),
  ('现泡绿茶(壶)',   'drink', 20, -1,  1, datetime('now'));

-- ---------- 商品（零食） ----------
INSERT INTO products (name, category, price, stock, is_active, created_at) VALUES
  ('瓜子(盘)',     'snack', 10, -1, 1, datetime('now')),
  ('花生(盘)',     'snack', 8,  -1, 1, datetime('now')),
  ('乐事薯片',     'snack', 8,  60, 1, datetime('now')),
  ('卫龙辣条',     'snack', 6,  60, 1, datetime('now')),
  ('水果拼盘',     'snack', 38, -1, 1, datetime('now'));
