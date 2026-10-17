-- Everyday changes. Paste into the D1 console and edit the values.

-- Change buffers or notice on a meeting type
UPDATE meeting_types SET buffer_before_mins = 10, buffer_after_mins = 15, min_notice_hours = 24
WHERE site_key = 'example' AND slug = 'intro';

-- Change how long a meeting is
UPDATE meeting_types SET duration_mins = 45 WHERE site_key = 'example' AND slug = 'intro';

-- Limit bookings per day for a meeting type (NULL for no limit)
UPDATE meeting_types SET daily_limit = 3 WHERE site_key = 'example' AND slug = 'intro';

-- Hide a meeting type without deleting it
UPDATE meeting_types SET active = 0 WHERE site_key = 'example' AND slug = 'intro';

-- See a schedule's hours
SELECT * FROM schedule_hours WHERE schedule_key = 'consulting' ORDER BY day, start_time;

-- Replace a schedule's hours completely
DELETE FROM schedule_hours WHERE schedule_key = 'consulting';
INSERT INTO schedule_hours (schedule_key, day, start_time, end_time) VALUES
  ('consulting', 1, '10:00', '16:00'),
  ('consulting', 3, '10:00', '16:00');

-- Block a holiday (NULL schedule_key blocks everything)
INSERT INTO blocked_dates (schedule_key, start_date, end_date, note)
VALUES (NULL, '2027-05-10', '2027-05-21', 'Holiday');

-- Allow another domain on a site (e.g. a Lovable preview)
UPDATE sites SET allowed_origins = allowed_origins || ',https://*.lovable.app' WHERE key = 'example';

-- Upcoming bookings
SELECT b.name, b.email, m.name AS meeting, datetime(b.start_utc / 1000, 'unixepoch') AS start_utc, b.status
FROM bookings b JOIN meeting_types m ON m.id = b.meeting_type_id
WHERE b.start_utc > unixepoch() * 1000 ORDER BY b.start_utc;
