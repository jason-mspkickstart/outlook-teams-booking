// The Worker runs these on first request, so nobody has to run SQL to get started.
// Every statement is safe to run again.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sites (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host_name TEXT NOT NULL DEFAULT '',
    allowed_origins TEXT NOT NULL DEFAULT '',
    sender_email TEXT,
    sender_name TEXT,
    manage_url TEXT,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS schedules (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/London'
  )`,
  `CREATE TABLE IF NOT EXISTS schedule_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_key TEXT NOT NULL,
    day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_key TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS meeting_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_key TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    duration_mins INTEGER NOT NULL DEFAULT 30,
    buffer_before_mins INTEGER NOT NULL DEFAULT 0,
    buffer_after_mins INTEGER NOT NULL DEFAULT 15,
    min_notice_hours INTEGER NOT NULL DEFAULT 12,
    max_days_ahead INTEGER NOT NULL DEFAULT 30,
    slot_step_mins INTEGER NOT NULL DEFAULT 30,
    daily_limit INTEGER,
    schedule_key TEXT NOT NULL DEFAULT 'default',
    invite_subject TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (site_key, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_type_id INTEGER NOT NULL,
    field_key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'textarea', 'select')),
    options TEXT,
    required INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    site_key TEXT NOT NULL,
    meeting_type_id INTEGER NOT NULL,
    start_utc INTEGER NOT NULL,
    end_utc INTEGER NOT NULL,
    local_date TEXT NOT NULL,
    visitor_tz TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    answers TEXT,
    event_id TEXT,
    join_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cancel_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    cancelled_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings (start_utc, end_utc)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_type_day ON bookings (meeting_type_id, local_date)`,
];
