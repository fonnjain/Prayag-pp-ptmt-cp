-- Durable browser activity audit. Activity is intentionally limited to
-- authenticated account, app, route, page, and named-action metadata.
CREATE TABLE IF NOT EXISTS user_activity_sessions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app            TEXT NOT NULL,
  started_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMP WITH TIME ZONE,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds   INTEGER NOT NULL DEFAULT 0,
  last_route     TEXT
);

CREATE INDEX IF NOT EXISTS user_activity_sessions_user_started_idx
  ON user_activity_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS user_activity_sessions_app_started_idx
  ON user_activity_sessions(app, started_at);

CREATE TABLE IF NOT EXISTS user_activity_events (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES user_activity_sessions(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  route       TEXT,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_activity_events_user_occurred_idx
  ON user_activity_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS user_activity_events_session_occurred_idx
  ON user_activity_events(session_id, occurred_at);