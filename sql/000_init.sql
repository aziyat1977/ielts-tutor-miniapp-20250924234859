CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT UNIQUE,
  username TEXT,
  lang TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  premium_tier TEXT,
  streak_days INTEGER DEFAULT 0,
  last_active_at TEXT,
  referral_code TEXT,
  referred_by TEXT
);
CREATE TABLE IF NOT EXISTS prompts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT,
  payload TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS essays(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  task_type TEXT,
  prompt_id INTEGER,
  raw_text TEXT,
  image_url TEXT,
  tokens_used INTEGER,
  band_overall REAL,
  band_task REAL,
  band_coherence REAL,
  band_lexical REAL,
  band_grammar REAL,
  feedback_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  provider TEXT,
  stars INTEGER,
  amount_usd REAL,
  status TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);