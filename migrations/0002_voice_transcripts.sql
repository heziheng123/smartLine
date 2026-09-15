CREATE TABLE IF NOT EXISTS review_transcription_operations (
  user_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  receipt_json TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, review_date, segment_id, operation_id)
);
