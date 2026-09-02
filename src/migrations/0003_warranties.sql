CREATE TABLE IF NOT EXISTS warranties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    warranty_type TEXT NOT NULL DEFAULT 'standard'
        CHECK(warranty_type IN ('standard', 'extended', 'accidental')),
    start_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    warranty_status TEXT NOT NULL DEFAULT 'active'
        CHECK(warranty_status IN ('active', 'expiring', 'expired', 'claimed')),
    coverage_details TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warranties_expiry ON warranties(expiry_date);
CREATE INDEX IF NOT EXISTS idx_warranties_status ON warranties(warranty_status);
CREATE INDEX IF NOT EXISTS idx_warranties_purchase ON warranties(purchase_id);

-- Recreate notification_log to include 'warranty' in entity_type CHECK
-- SQLite cannot ALTER CHECK constraints, so we recreate the table
CREATE TABLE IF NOT EXISTS notification_log_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('purchase', 'rebate', 'warranty')),
    entity_id INTEGER NOT NULL,
    notification_type TEXT NOT NULL CHECK(notification_type IN ('7day', '1day')),
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO notification_log_new SELECT * FROM notification_log;
DROP TABLE notification_log;
ALTER TABLE notification_log_new RENAME TO notification_log;
CREATE INDEX IF NOT EXISTS idx_notif_log_entity ON notification_log(entity_type, entity_id);

INSERT INTO schema_version (version) VALUES (3);
