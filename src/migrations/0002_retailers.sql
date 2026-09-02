INSERT OR IGNORE INTO retailers (name, default_return_days) VALUES
  ('Amazon', 30),
  ('Best Buy', 15),
  ('Apple', 14),
  ('Costco', 90),
  ('Target', 90),
  ('Walmart', 30),
  ('B&H Photo', 30),
  ('Newegg', 30),
  ('Adorama', 30),
  ('REI', 365),
  ('Home Depot', 90),
  ('Lowe''s', 90),
  ('Micro Center', 15),
  ('GameStop', 7),
  ('Steam', 14),
  ('Nike', 30),
  ('IKEA', 365),
  ('Chewy', 365),
  ('Dell', 30),
  ('Other', 30);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('default_return_days', '30'),
  ('notify_7day', 'true'),
  ('notify_1day', 'true'),
  ('notification_permission_requested', 'false');

INSERT INTO schema_version (version) VALUES (2);
