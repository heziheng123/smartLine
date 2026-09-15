CREATE TABLE IF NOT EXISTS review_records (
  user_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'completed')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, review_date)
);

CREATE TABLE IF NOT EXISTS review_operations (
  user_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, review_date, operation_id)
);

CREATE TABLE IF NOT EXISTS review_ai_operations (
  user_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  review_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  response_json TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, review_date, operation_id)
);
