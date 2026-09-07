-- 用户表（Telegram 用户）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  telegram_username TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 监控航线表
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  origin TEXT NOT NULL,           -- 出发机场 IATA code (NGB/HGH/PVG/SHA)
  destination TEXT,               -- 目的地 IATA code，NULL = 探索模式（任意目的地）
  date_from TEXT NOT NULL,        -- 出发日期范围开始 YYYY-MM-DD
  date_to TEXT NOT NULL,          -- 出发日期范围结束 YYYY-MM-DD
  return_from TEXT,               -- 返程日期范围（NULL = 单程）
  return_to TEXT,
  max_price INTEGER NOT NULL,     -- 价格阈值（人民币）
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 价格记录表
CREATE TABLE IF NOT EXISTS price_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  price INTEGER NOT NULL,           -- 最低价（人民币）
  currency TEXT NOT NULL DEFAULT 'CNY',
  airline TEXT,                     -- 航司名
  flight_number TEXT,               -- 航班号
  departure_time TEXT,              -- 起飞时间
  arrival_time TEXT,                -- 到达时间
  stops INTEGER DEFAULT 0,          -- 经停次数
  duration_minutes INTEGER,         -- 飞行时长（分钟）
  source TEXT NOT NULL,             -- 数据来源: serpapi/skyscrapper/spring
  booking_url TEXT,                 -- 预订链接
  price_level TEXT,                 -- low/typical/high (from Google price insights)
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (route_id) REFERENCES routes(id)
);

-- 推送记录表（防重复推送）
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  airline TEXT,
  message TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (route_id) REFERENCES routes(id)
);

-- 热门目的地缓存（explore 模式用）
CREATE TABLE IF NOT EXISTS popular_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_name TEXT,
  min_price INTEGER,
  typical_price INTEGER,
  best_month TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_routes_user ON routes(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_routes_active ON routes(is_active, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_prices_route ON price_records(route_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_alerts_route ON alerts(route_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_popular_origin ON popular_destinations(origin);
