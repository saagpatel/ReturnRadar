CREATE TABLE IF NOT EXISTS capture_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    document_kind TEXT NOT NULL CHECK(document_kind IN ('image', 'pdf')),
    source_label TEXT NOT NULL,
    raw_content_retained INTEGER NOT NULL DEFAULT 0 CHECK(raw_content_retained = 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS captured_deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES capture_sources(id) ON DELETE RESTRICT,
    deadline_type TEXT NOT NULL
        CHECK(deadline_type IN ('return', 'rebate', 'warranty', 'price_adjustment')),
    title TEXT NOT NULL,
    merchant TEXT,
    transaction_date DATE,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'resolved', 'expired')),
    evidence_json TEXT NOT NULL,
    corrections_json TEXT NOT NULL DEFAULT '[]',
    confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_captured_deadlines_due_date
    ON captured_deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_captured_deadlines_type
    ON captured_deadlines(deadline_type);
CREATE INDEX IF NOT EXISTS idx_captured_deadlines_source
    ON captured_deadlines(source_id);

INSERT INTO schema_version (version) VALUES (4);
