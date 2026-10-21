-- Add holidays table for academic calendar
CREATE TABLE holidays (
  id           TEXT PRIMARY KEY,
  holiday_date TEXT NOT NULL UNIQUE,           -- YYYY-MM-DD format
  name         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('Festival', 'Exam', 'Weekend', 'Other')),
  description  TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX ix_holidays_date ON holidays(holiday_date);
CREATE INDEX ix_holidays_category ON holidays(category);
