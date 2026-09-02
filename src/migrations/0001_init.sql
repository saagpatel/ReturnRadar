CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retailers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    default_return_days INTEGER NOT NULL DEFAULT 30,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT NOT NULL,
    retailer_id INTEGER REFERENCES retailers(id) ON DELETE SET NULL,
    retailer_name_override TEXT,
    purchase_date DATE NOT NULL,
    price_cents INTEGER NOT NULL,
    return_window_days INTEGER NOT NULL,
    return_deadline DATE NOT NULL,
    return_status TEXT NOT NULL DEFAULT 'open'
        CHECK(return_status IN ('open', 'expiring', 'returned', 'kept', 'expired')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rebates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    rebate_amount_cents INTEGER NOT NULL,
    submission_deadline DATE NOT NULL,
    submission_status TEXT NOT NULL DEFAULT 'pending'
        CHECK(submission_status IN ('pending', 'submitted', 'received', 'expired')),
    submitted_at DATE,
    received_at DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('purchase', 'rebate')),
    entity_id INTEGER NOT NULL,
    notification_type TEXT NOT NULL CHECK(notification_type IN ('7day', '1day')),
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchases_return_deadline ON purchases(return_deadline);
CREATE INDEX IF NOT EXISTS idx_purchases_return_status ON purchases(return_status);
CREATE INDEX IF NOT EXISTS idx_rebates_deadline ON rebates(submission_deadline);
CREATE INDEX IF NOT EXISTS idx_rebates_status ON rebates(submission_status);
CREATE INDEX IF NOT EXISTS idx_notif_log_entity ON notification_log(entity_type, entity_id);

INSERT INTO schema_version (version) VALUES (1);
