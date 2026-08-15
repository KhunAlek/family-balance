PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  disabled_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_household_active
  ON push_subscriptions(household_id, disabled_at, actor_email);

CREATE TABLE IF NOT EXISTS notification_history (
  notification_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT NOT NULL DEFAULT '/',
  business_date TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  intended_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_history_household_created
  ON notification_history(household_id, created_at DESC);
