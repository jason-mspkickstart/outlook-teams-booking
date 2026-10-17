-- Example setup. Paste into Cloudflare dashboard > Storage & Databases > D1 >
-- outlook-teams-booking > Console, after changing the values to suit you.
-- The tables already exist, the Worker creates them on first request.
-- Hit your Worker's /health URL once first if the console says a table is missing.

-- 1. Schedules: when you're available. One per set of hours.
INSERT INTO schedules (key, name, timezone) VALUES
  ('consulting', 'Consulting hours', 'Europe/London'),
  ('product', 'Product demos', 'Europe/London');

-- 2. Working hours. day: 1 = Monday ... 7 = Sunday. Times are local to the schedule.
--    Add two rows for the same day to get a lunch break.
INSERT INTO schedule_hours (schedule_key, day, start_time, end_time) VALUES
  ('consulting', 2, '13:00', '17:00'),
  ('consulting', 4, '13:00', '17:00'),
  ('product', 1, '09:30', '12:30'), ('product', 1, '13:30', '17:00'),
  ('product', 2, '09:30', '12:30'), ('product', 2, '13:30', '17:00'),
  ('product', 3, '09:30', '12:30'), ('product', 3, '13:30', '17:00'),
  ('product', 4, '09:30', '12:30'), ('product', 4, '13:30', '17:00'),
  ('product', 5, '09:30', '12:30');

-- 3. Sites: one row per website.
--    allowed_origins: comma separated, no trailing slash. Wildcards like https://*.lovable.app work.
--    sender_email: address the confirmation email comes from. Leave NULL to skip that email.
--    manage_url: page on that site that handles ?token= for reschedule and cancel.
INSERT INTO sites (key, name, host_name, allowed_origins, sender_email, sender_name, manage_url) VALUES
  ('example', 'Example Ltd', 'Alex Smith',
   'https://example.com,https://www.example.com',
   'hello@example.com', 'Example Ltd',
   'https://example.com/booking/manage'),
  ('example-product', 'Example Product', 'Alex Smith',
   'https://exampleproduct.com',
   'hello@exampleproduct.com', 'Example Product',
   'https://exampleproduct.com/demo/manage');

-- 4. Meeting types. Only site_key, slug, name and schedule_key are really needed,
--    everything else has a sensible default.
INSERT INTO meeting_types
  (site_key, slug, name, description, duration_mins, buffer_after_mins, min_notice_hours, max_days_ahead, schedule_key, invite_subject)
VALUES
  ('example', 'intro', 'Intro call', 'A quick 30 minute chat to see if we can help.', 30, 15, 24, 21, 'consulting', 'Intro call: {name}'),
  ('example-product', 'demo', 'Product demo', 'A walkthrough of the product.', 45, 15, 12, 30, 'product', '{site} demo: {name}');

-- 5. Intake questions (optional). type: text, textarea or select. options are pipe separated.
INSERT INTO questions (meeting_type_id, field_key, label, type, options, required, sort_order) VALUES
  ((SELECT id FROM meeting_types WHERE site_key = 'example' AND slug = 'intro'), 'company', 'Company name', 'text', NULL, 1, 1),
  ((SELECT id FROM meeting_types WHERE site_key = 'example' AND slug = 'intro'), 'topic', 'What would you like to cover?', 'textarea', NULL, 0, 2),
  ((SELECT id FROM meeting_types WHERE site_key = 'example-product' AND slug = 'demo'), 'sites', 'How many sites?', 'select', '1|2 to 5|6 to 20|20+', 1, 1);

-- 6. Blocked dates (optional). schedule_key NULL blocks every schedule.
INSERT INTO blocked_dates (schedule_key, start_date, end_date, note) VALUES
  (NULL, '2026-12-24', '2027-01-02', 'Christmas');
