use chrono::NaiveDate;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::OnceLock;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use super::document_capture::CaptureSessionRegistry;

const MAX_CONFIRMED_DEADLINES: usize = 8;
const MAX_TITLE_CHARACTERS: usize = 200;
const MAX_MERCHANT_CHARACTERS: usize = 200;
const MAX_EVIDENCE_SPANS: usize = 6;
const MAX_EVIDENCE_CHARACTERS: usize = 240;
const MAX_CORRECTIONS: usize = 24;
const MAX_CORRECTION_CHARACTERS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmationSourceInput {
    fingerprint: String,
    kind: String,
    extraction_token: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceSpanInput {
    page: usize,
    line: usize,
    text: String,
    confidence: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmedDeadlineInput {
    deadline_type: String,
    title: String,
    due_date: String,
    reviewed: bool,
    evidence: Vec<EvidenceSpanInput>,
    corrections: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmDeadlineCaptureInput {
    confirmation_intent: String,
    source: ConfirmationSourceInput,
    merchant: Option<String>,
    transaction_date: Option<String>,
    deadlines: Vec<ConfirmedDeadlineInput>,
}

fn valid_iso_date(value: &str) -> bool {
    value.len() == 10 && NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn redact_addresses_preserving_policy(
    text: &str,
    address: &Regex,
    policy_boundary: &Regex,
) -> String {
    static DURATION_ADDRESS_PREFIX: OnceLock<Regex> = OnceLock::new();
    static POLICY_PREFIX_BEFORE_KEYWORD: OnceLock<Regex> = OnceLock::new();
    let duration_address_prefix = DURATION_ADDRESS_PREFIX.get_or_init(|| {
        Regex::new(r"(?i)^\d{1,6}\s+(?:days?|weeks?|months?|years?)\b")
            .expect("duration address-prefix regex")
    });
    let policy_prefix_before_keyword = POLICY_PREFIX_BEFORE_KEYWORD.get_or_init(|| {
        Regex::new(r"(?i)\b(?:\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)|opened|unopened|unused|used|damaged|defective|sale|clearance|custom|personalized|perishable|electronics|items?|products?|goods|may|must|can|cannot|not|never|no|except|excluded)\b")
            .expect("policy prefix-before-keyword regex")
    });
    let mut redacted = String::with_capacity(text.len());
    for segment in text.split_inclusive('\n') {
        let (line, newline) = segment
            .strip_suffix('\n')
            .map_or((segment, ""), |line| (line, "\n"));
        let Some(address_match) = address.find(line) else {
            redacted.push_str(line);
            redacted.push_str(newline);
            continue;
        };
        let mut cursor = 0usize;
        let mut next_address = Some(address_match);
        while let Some(address_match) = next_address {
            let address_start = cursor + address_match.start();
            let address_end = cursor + address_match.end();
            if duration_address_prefix.is_match(address_match.as_str()) {
                redacted.push_str(&line[cursor..address_end]);
                cursor = address_end;
                next_address = address.find(&line[cursor..]);
                continue;
            }
            redacted.push_str(&line[cursor..address_start]);
            redacted.push_str("[ADDRESS REDACTED]");
            let tail = &line[address_end..];
            let Some(policy_match) = policy_boundary.find(tail) else {
                cursor = line.len();
                break;
            };
            let policy_prefix = policy_prefix_before_keyword
                .find(&tail[..policy_match.start()])
                .map_or(policy_match.start(), |matched| matched.start());
            redacted.push(' ');
            cursor = address_end + policy_prefix;
            next_address = address.find(&line[cursor..]);
        }
        if cursor < line.len() {
            redacted.push_str(&line[cursor..]);
        }
        redacted.push_str(newline);
    }
    redacted
}

fn redact_sensitive_text(text: &str) -> String {
    static PAYMENT_CARD: OnceLock<Regex> = OnceLock::new();
    static PAYMENT_CARD_FRAGMENT: OnceLock<Regex> = OnceLock::new();
    static ADDRESS: OnceLock<Regex> = OnceLock::new();
    static POLICY_AFTER_ADDRESS: OnceLock<Regex> = OnceLock::new();
    static LABELED_LOYALTY: OnceLock<Regex> = OnceLock::new();
    static LABELED_TRANSACTION: OnceLock<Regex> = OnceLock::new();

    let payment_card = PAYMENT_CARD
        .get_or_init(|| Regex::new(r"\b(?:(?:\d{4}[ -]){2,3}\d{4}|(?:\d{4}[ -]){4}\d{3}|\d{4}[ -]\d{6}[ -]\d{5}|\d{12,19})\b").expect("card redaction regex"));
    let payment_card_fragment = PAYMENT_CARD_FRAGMENT.get_or_init(|| {
        Regex::new(r"(?i)\b(?:card|visa|mastercard|amex|discover)\s*(?:ending(?:\s+in)?|ends?\s+in|last\s*4|no|number|#)?\s*[:#-]?\s*(?:[*xX•][*xX• -]*)?(?:\d[ -]?){3}\d\b")
            .expect("card fragment redaction regex")
    });
    let address = ADDRESS.get_or_init(|| {
        Regex::new(r"(?i)\b\d{1,6}\s+(?:(?:\d+(?:st|nd|rd|th)|[A-Za-z][A-Za-z0-9.'-]*)\s+){1,6}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Circle|Cir|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Place|Pl|Plaza|Plz|Square|Sq|Trail|Trl|Crescent|Cres|Turnpike|Tpke)\b")
            .expect("address redaction regex")
    });
    let policy_after_address = POLICY_AFTER_ADDRESS.get_or_init(|| {
        Regex::new(r"(?i)\b(?:(?:we|store|merchant)\s+(?:(?:do|does|did)(?:\s+(?:not|never)|n['’]?t)\s+accept|den(?:y|ies|ied)|refus(?:e|es|ed))\s+(?:returns?|refunds?|exchanges?)|(?:(?:do|does|did)\s+(?:not|never)|(?:do|does|did)n['’]?t|can(?:not|['’]t)|(?:could|would|might)n['’]?t|(?:will|may|might|must|shall|should|could|would)\s+(?:not|never)|(?:may|must|shall|should)n['’]?t|won['’]?t)\s+accept\s+(?:returns?|refunds?|exchanges?)|no\s+(?:returns?|refunds?|exchanges?|warrant(?:y|ies))|(?:not|never)\s+(?:covered|included)\s+(?:by|under)\s+(?:the\s+)?warrant(?:y|ies)|except(?:\s+[A-Za-z0-9&/'-]+){0,8}\s+(?:returns?|refunds?|exchanges?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))|excluded(?:\s+[A-Za-z0-9&/'-]+){0,6}\s+warrant(?:y|ies)|non-?returnable|(?:not|never)\s+returnable|return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment)|final\s+sale|all\s+sales?)\b")
            .expect("policy-after-address regex")
    });
    let labeled_loyalty = LABELED_LOYALTY.get_or_init(|| {
        Regex::new(r"(?i)\b(?:loyalty|member|rewards)\b\s*(?:(?:(?:id|no|number)\s*\.?|#)\s*[:,#-]?|[:,#-])\s*[A-Z0-9][A-Z0-9/._-]{1,}\b")
            .expect("labeled loyalty redaction regex")
    });
    let labeled_transaction = LABELED_TRANSACTION.get_or_init(|| {
        Regex::new(r"(?i)\b(?:transaction|trans|order|receipt|invoice|document|confirmation|reference|ref|account)\b\s*(?:(?:(?:id|no|number)\s*\.?|#)\s*[:,#-]?|[:,#-])\s*[A-Z0-9][A-Z0-9/._-]{1,}\b")
            .expect("labeled transaction redaction regex")
    });

    let redacted = payment_card.replace_all(text, "[PAYMENT CARD REDACTED]");
    let redacted = payment_card_fragment.replace_all(&redacted, "[PAYMENT CARD REDACTED]");
    let redacted = redact_addresses_preserving_policy(&redacted, address, policy_after_address);
    let redacted = labeled_loyalty.replace_all(&redacted, "[LOYALTY IDENTIFIER REDACTED]");
    labeled_transaction
        .replace_all(&redacted, "[TRANSACTION IDENTIFIER REDACTED]")
        .into_owned()
}

fn sanitized_evidence_json(evidence: &[EvidenceSpanInput]) -> Result<String, String> {
    let sanitized: Vec<EvidenceSpanInput> = evidence
        .iter()
        .map(|span| EvidenceSpanInput {
            page: span.page,
            line: span.line,
            text: redact_sensitive_text(&span.text),
            confidence: span.confidence,
        })
        .collect();
    serde_json::to_string(&sanitized)
        .map_err(|error| format!("Could not serialize bounded evidence: {error}"))
}

fn validate_confirmation(input: &ConfirmDeadlineCaptureInput) -> Result<(), String> {
    if input.confirmation_intent != "confirm_and_create" {
        return Err("Explicit confirmation is required before creating a deadline.".into());
    }
    if input.source.fingerprint.len() != 64
        || !input
            .source
            .fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("The selected document fingerprint is invalid.".into());
    }
    if !matches!(input.source.kind.as_str(), "image" | "pdf") {
        return Err("The selected document kind is invalid.".into());
    }
    if uuid::Uuid::parse_str(&input.source.extraction_token).is_err() {
        return Err("The selected document extraction token is invalid.".into());
    }
    if input.deadlines.is_empty() || input.deadlines.len() > MAX_CONFIRMED_DEADLINES {
        return Err(format!(
            "Confirm between 1 and {MAX_CONFIRMED_DEADLINES} deadlines at a time."
        ));
    }
    if input
        .merchant
        .as_ref()
        .is_some_and(|value| value.chars().count() > MAX_MERCHANT_CHARACTERS)
    {
        return Err("Merchant exceeds the local storage limit.".into());
    }
    if input
        .transaction_date
        .as_ref()
        .is_some_and(|value| !valid_iso_date(value))
    {
        return Err("The confirmed transaction date is invalid.".into());
    }
    for deadline in &input.deadlines {
        if !deadline.reviewed {
            return Err("Review every selected deadline before confirming.".into());
        }
        let title = deadline.title.trim();
        if title.is_empty() || title.chars().count() > MAX_TITLE_CHARACTERS {
            return Err("Every deadline needs a bounded title.".into());
        }
        if !valid_iso_date(&deadline.due_date) {
            return Err("Every deadline needs an explicit ISO date.".into());
        }
        if !matches!(
            deadline.deadline_type.as_str(),
            "return" | "rebate" | "warranty" | "price_adjustment"
        ) {
            return Err("The confirmed deadline type is invalid.".into());
        }
        if deadline.evidence.len() > MAX_EVIDENCE_SPANS {
            return Err("Confirmed evidence exceeds the local span limit.".into());
        }
        for span in &deadline.evidence {
            if span.page == 0
                || span.line > 100_000
                || span.text.chars().count() > MAX_EVIDENCE_CHARACTERS
                || !span.confidence.is_finite()
                || !(0.0..=1.0).contains(&span.confidence)
            {
                return Err("Confirmed evidence is invalid or exceeds the local limit.".into());
            }
        }
        if deadline.corrections.len() > MAX_CORRECTIONS
            || deadline.corrections.iter().any(|value| {
                value.is_empty()
                    || value.chars().count() > MAX_CORRECTION_CHARACTERS
                    || !value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
            })
        {
            return Err("Correction provenance is invalid or exceeds the local limit.".into());
        }
    }
    Ok(())
}

async fn persist_confirmed_deadlines(
    pool: &SqlitePool,
    input: &ConfirmDeadlineCaptureInput,
) -> Result<usize, String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not begin the local confirmation transaction: {error}"))?;

    let source_label = format!(
        "{} • {}",
        if input.source.kind == "pdf" {
            "PDF"
        } else {
            "Image"
        },
        &input.source.fingerprint[..10]
    );
    sqlx::query(
        "INSERT OR IGNORE INTO capture_sources
            (fingerprint, document_kind, source_label, raw_content_retained)
         VALUES (?, ?, ?, 0)",
    )
    .bind(&input.source.fingerprint)
    .bind(&input.source.kind)
    .bind(source_label)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not bind local document provenance: {error}"))?;

    let source_id: i64 = sqlx::query("SELECT id FROM capture_sources WHERE fingerprint = ?")
        .bind(&input.source.fingerprint)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| format!("Could not read local document provenance: {error}"))?
        .try_get("id")
        .map_err(|error| format!("Could not decode local document provenance: {error}"))?;

    for deadline in &input.deadlines {
        let evidence_json = sanitized_evidence_json(&deadline.evidence)?;
        let corrections_json = serde_json::to_string(&deadline.corrections)
            .map_err(|error| format!("Could not serialize correction provenance: {error}"))?;
        sqlx::query(
            "INSERT INTO captured_deadlines
                (source_id, deadline_type, title, merchant, transaction_date,
                 due_date, evidence_json, corrections_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(source_id)
        .bind(&deadline.deadline_type)
        .bind(deadline.title.trim())
        .bind(
            input
                .merchant
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(input.transaction_date.as_deref())
        .bind(&deadline.due_date)
        .bind(evidence_json)
        .bind(corrections_json)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not create a confirmed local deadline: {error}"))?;
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit the local confirmation transaction: {error}"))?;
    Ok(input.deadlines.len())
}

async fn confirm_deadline_capture_with_pool(
    pool: &SqlitePool,
    capture_sessions: &CaptureSessionRegistry,
    input: &ConfirmDeadlineCaptureInput,
) -> Result<usize, String> {
    validate_confirmation(input)?;
    let token = input.source.extraction_token.clone();
    let session =
        capture_sessions.take_matching(&token, &input.source.fingerprint, &input.source.kind)?;
    match persist_confirmed_deadlines(pool, input).await {
        Ok(count) => Ok(count),
        Err(error) => match capture_sessions.restore(token, session) {
            Ok(()) => Err(error),
            Err(restore_error) => Err(format!("{error} {restore_error}")),
        },
    }
}

#[tauri::command]
pub async fn confirm_deadline_capture(
    db_instances: State<'_, DbInstances>,
    capture_sessions: State<'_, CaptureSessionRegistry>,
    input: ConfirmDeadlineCaptureInput,
) -> Result<usize, String> {
    // Reject malformed or unconfirmed requests before touching persistence so
    // callers get the confidence-gate error even if storage is unavailable.
    validate_confirmation(&input)?;

    let instances = db_instances.0.read().await;
    if instances.len() != 1 {
        return Err("The local deadline database is not uniquely available.".into());
    }
    let pool = match instances.values().next() {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("The local deadline database is not SQLite.".into()),
    };
    confirm_deadline_capture_with_pool(pool, &capture_sessions, &input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn valid_input() -> ConfirmDeadlineCaptureInput {
        ConfirmDeadlineCaptureInput {
            confirmation_intent: "confirm_and_create".into(),
            source: ConfirmationSourceInput {
                fingerprint: "a".repeat(64),
                kind: "image".into(),
                extraction_token: "00000000-0000-4000-8000-000000000001".into(),
            },
            merchant: Some("Northstar Outfitters".into()),
            transaction_date: Some("2026-01-15".into()),
            deadlines: vec![ConfirmedDeadlineInput {
                deadline_type: "return".into(),
                title: "Trail Bottle return".into(),
                due_date: "2026-02-14".into(),
                reviewed: true,
                evidence: vec![],
                corrections: vec![],
            }],
        }
    }

    #[test]
    fn validates_the_native_confirmation_gate() {
        assert!(validate_confirmation(&valid_input()).is_ok());
        let mut unconfirmed = valid_input();
        unconfirmed.confirmation_intent = "not_confirmed".into();
        assert!(validate_confirmation(&unconfirmed).is_err());
    }

    #[test]
    fn rejects_invalid_dates_and_unreviewed_deadlines() {
        let mut invalid = valid_input();
        invalid.deadlines[0].due_date = "2026-02-31".into();
        assert!(validate_confirmation(&invalid).is_err());
        let mut unreviewed = valid_input();
        unreviewed.deadlines[0].reviewed = false;
        assert!(validate_confirmation(&unreviewed).is_err());
    }

    #[test]
    fn redacts_sensitive_evidence_again_at_the_native_boundary() {
        let evidence = vec![EvidenceSpanInput {
            page: 1,
            line: 2,
            text: "Card 4111 1111 1111 1111; Visa ending 4242 at 123 Market Street Portland; Loyalty ID MEMBER-88291; Transaction # ABCD-1234; Receipt # 12/3456; Order: 123; Invoice #ABC123 Returns within 30 days; Member # 7/82".into(),
            confidence: 0.98,
        }];
        let json = sanitized_evidence_json(&evidence).expect("evidence should serialize");
        assert!(!json.contains("4111"));
        assert!(!json.contains("4242"));
        assert!(!json.contains("123 Market Street"));
        assert!(!json.contains("MEMBER-88291"));
        assert!(!json.contains("ABCD-1234"));
        assert!(!json.contains("12/3456"));
        assert!(!json.contains("Order: 123"));
        assert!(!json.contains("ABC123"));
        assert!(!json.contains("7/82"));
        assert!(json.contains("Returns within 30 days"));
        assert!(json.contains("REDACTED"));
    }

    #[test]
    fn native_redaction_preserves_same_line_policy_meaning() {
        for policy in [
            "Returns within 30 days",
            "No returns accepted for opened electronics",
            "Not covered by warranty after misuse",
            "Except electronics returns are accepted within 30 days",
            "Excluded from the warranty coverage",
            "Store does not accept returns for opened items",
            "We deny refunds for clearance items",
            "Not included under warranty after misuse",
        ] {
            let redacted = redact_sensitive_text(&format!("123 Market Street Portland {policy}"));
            assert_eq!(redacted, format!("[ADDRESS REDACTED] {policy}"));
        }
        assert_eq!(
            redact_sensitive_text("123 Market Street Returns accepted; 456 Oak Road"),
            "[ADDRESS REDACTED] Returns accepted; [ADDRESS REDACTED]"
        );

        for suffix in ["Court", "Circle", "Terrace", "Parkway", "Highway"] {
            let redacted =
                redact_sensitive_text(&format!("42 Pine {suffix} Returns within 30 days"));
            assert_eq!(redacted, "[ADDRESS REDACTED] Returns within 30 days");
        }

        for policy in [
            "Receipt required for returns within 30 days",
            "Order must be returned within 30 days",
            "Member benefits remain available",
        ] {
            assert_eq!(redact_sensitive_text(policy), policy);
        }

        assert_eq!(
            redact_sensitive_text("Visa 4242 90-day returns"),
            "[PAYMENT CARD REDACTED] 90-day returns"
        );
        assert_eq!(
            redact_sensitive_text("Visa ending 4242 Returns within 30 days"),
            "[PAYMENT CARD REDACTED] Returns within 30 days"
        );
        assert_eq!(
            redact_sensitive_text("Visa ending in 4242 Returns within 30 days"),
            "[PAYMENT CARD REDACTED] Returns within 30 days"
        );
        assert_eq!(
            redact_sensitive_text("Card 4111 1111 1111 1111 90-day returns"),
            "Card [PAYMENT CARD REDACTED] 90-day returns"
        );
        assert_eq!(
            redact_sensitive_text("Returns within 30 days at 123 Market Street"),
            "Returns within 30 days at [ADDRESS REDACTED]"
        );
        assert_eq!(
            redact_sensitive_text("Returns within 30 days at Main Street locations"),
            "Returns within 30 days at Main Street locations"
        );
        assert_eq!(
            redact_sensitive_text("123 Market Street 30-day returns"),
            "[ADDRESS REDACTED] 30-day returns"
        );
        assert_eq!(
            redact_sensitive_text("123 Market Street Opened items may not be returned"),
            "[ADDRESS REDACTED] Opened items may not be returned"
        );
        assert_eq!(
            redact_sensitive_text("123 Market Street Opened items are not returnable"),
            "[ADDRESS REDACTED] Opened items are not returnable"
        );

        let punctuated = redact_sensitive_text(
			"Receipt No. 12/3456; Order No. 123; Member No. 7/82; Receipt No . 34/5678; Receipt No., 56/7890",
		);
        assert!(!punctuated.contains("12/3456"));
        assert!(!punctuated.contains("Order No. 123"));
        assert!(!punctuated.contains("7/82"));
        assert!(!punctuated.contains("34/5678"));
        assert!(!punctuated.contains("56/7890"));
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory database");
        sqlx::query(
            "CREATE TABLE capture_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fingerprint TEXT NOT NULL UNIQUE,
                document_kind TEXT NOT NULL,
                source_label TEXT NOT NULL,
                raw_content_retained INTEGER NOT NULL
            );
            CREATE TABLE captured_deadlines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL,
                deadline_type TEXT NOT NULL,
                title TEXT NOT NULL CHECK(title <> 'force rollback'),
                merchant TEXT,
                transaction_date TEXT,
                due_date TEXT NOT NULL,
                evidence_json TEXT NOT NULL,
                corrections_json TEXT NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .expect("test schema");
        pool
    }

    #[tokio::test]
    async fn persists_multiple_deadlines_atomically_and_reuses_source() {
        let pool = test_pool().await;
        let mut failing = valid_input();
        failing.deadlines.push(ConfirmedDeadlineInput {
            deadline_type: "warranty".into(),
            title: "force rollback".into(),
            due_date: "2027-01-15".into(),
            reviewed: true,
            evidence: vec![],
            corrections: vec![],
        });
        assert!(persist_confirmed_deadlines(&pool, &failing).await.is_err());
        let source_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capture_sources")
            .fetch_one(&pool)
            .await
            .expect("source count");
        let deadline_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM captured_deadlines")
            .fetch_one(&pool)
            .await
            .expect("deadline count");
        assert_eq!((source_count, deadline_count), (0, 0));

        let valid = valid_input();
        persist_confirmed_deadlines(&pool, &valid)
            .await
            .expect("first confirmation");
        persist_confirmed_deadlines(&pool, &valid)
            .await
            .expect("repeated source confirmation");
        let source_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM capture_sources")
            .fetch_one(&pool)
            .await
            .expect("source count");
        let deadline_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM captured_deadlines")
            .fetch_one(&pool)
            .await
            .expect("deadline count");
        assert_eq!((source_count, deadline_count), (1, 2));
    }

    #[tokio::test]
    async fn restores_the_native_extraction_session_after_transaction_failure() {
        let pool = test_pool().await;
        let sessions = CaptureSessionRegistry::default();
        let mut input = valid_input();
        input.source.extraction_token = sessions
            .register(input.source.fingerprint.clone(), input.source.kind.clone())
            .expect("register native extraction session");
        input.deadlines[0].title = "force rollback".into();

        assert!(confirm_deadline_capture_with_pool(&pool, &sessions, &input)
            .await
            .is_err());

        input.deadlines[0].title = "Recovered return deadline".into();
        assert_eq!(
            confirm_deadline_capture_with_pool(&pool, &sessions, &input)
                .await
                .expect("retry after transaction rollback"),
            1
        );
        assert!(confirm_deadline_capture_with_pool(&pool, &sessions, &input)
            .await
            .is_err());
    }
}
