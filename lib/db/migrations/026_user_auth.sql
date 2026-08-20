CREATE TABLE IF NOT EXISTS app_users (
  id                    SERIAL PRIMARY KEY,
  email                 TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
  ON app_users (email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash  TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_unique
  ON auth_sessions (token_hash);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
  ON auth_sessions (expires_at);