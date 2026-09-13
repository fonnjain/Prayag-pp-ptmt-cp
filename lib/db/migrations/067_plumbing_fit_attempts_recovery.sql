ALTER TABLE plumbing_fit_attempts
  DROP CONSTRAINT IF EXISTS plumbing_fit_attempts_request_fingerprint_key;

DROP INDEX IF EXISTS plumbing_fit_attempts_fingerprint_idx;

CREATE UNIQUE INDEX IF NOT EXISTS plumbing_fit_attempts_fingerprint_idx
  ON plumbing_fit_attempts(request_fingerprint)
  WHERE state <> 'abandoned';