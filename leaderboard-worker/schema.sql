CREATE TABLE IF NOT EXISTS leaderboard_entries (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  today_seconds INTEGER NOT NULL DEFAULT 0,
  all_time_seconds INTEGER NOT NULL DEFAULT 0,
  documents_tracked INTEGER NOT NULL DEFAULT 0,
  current_streak_days INTEGER NOT NULL DEFAULT 0,
  type_totals TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
ON leaderboard_entries(today_seconds DESC, all_time_seconds DESC);

CREATE TABLE IF NOT EXISTS waitlist_subscribers (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'landing-page',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at
ON waitlist_subscribers(created_at DESC);
