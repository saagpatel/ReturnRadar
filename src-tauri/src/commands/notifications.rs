use chrono::{Duration, Local};
use notify_rust::Notification;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;
use std::env;
use std::fs;
use std::path::PathBuf;
const PRODUCTION_APP_IDENTIFIER: &str = "com.returnradar.app";

fn may_install_production_agent(identifier: &str) -> bool {
    identifier == PRODUCTION_APP_IDENTIFIER
}

#[tauri::command]
pub fn notification_setup_allowed(app: tauri::AppHandle) -> bool {
    may_install_production_agent(&app.config().identifier)
}

fn get_db_path() -> Result<PathBuf, String> {
    let support_dir = dirs::data_dir()
        .ok_or("Could not resolve Application Support directory")?
        .join("com.returnradar.app");
    Ok(support_dir.join("return_radar.db"))
}

fn get_launch_agents_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or("Could not resolve home directory".to_string())
        .map(|h| h.join("Library").join("LaunchAgents"))
}

#[tauri::command]
pub async fn install_launchd_agent(app: tauri::AppHandle) -> Result<(), String> {
    // Fixture and acceptance builds must never overwrite the production agent.
    // This native boundary remains effective even when a frontend environment
    // variable is omitted or misconfigured.
    if !may_install_production_agent(&app.config().identifier) {
        return Ok(());
    }

    let agents_dir = get_launch_agents_dir()?;
    fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create LaunchAgents dir: {e}"))?;

    let exe_path = env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {e}"))?
        .to_string_lossy()
        .to_string();

    let plist_path = agents_dir.join("com.returnradar.checker.plist");
    let plist_content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.returnradar.checker</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe_path}</string>
        <string>--check-notifications</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>"#
    );

    fs::write(&plist_path, plist_content).map_err(|e| format!("Failed to write plist: {e}"))?;

    Ok(())
}

pub async fn check_notifications_headless() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = get_db_path()?;
    if !db_path.exists() {
        eprintln!(
            "Database not found at {:?}, skipping notification check",
            db_path
        );
        return Ok(());
    }

    let db_url = format!("sqlite:{}", db_path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_url)
        .await?;

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    // Read notification settings
    let settings: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM app_settings WHERE key IN ('notify_7day', 'notify_1day')",
    )
    .fetch_all(&pool)
    .await?;

    let notify_7day = settings
        .iter()
        .find(|(k, _)| k == "notify_7day")
        .is_none_or(|(_, v)| v != "false");
    let notify_1day = settings
        .iter()
        .find(|(k, _)| k == "notify_1day")
        .is_none_or(|(_, v)| v != "false");

    if !notify_7day && !notify_1day {
        return Ok(());
    }

    let _today = Local::now().format("%Y-%m-%d").to_string();
    let seven_day_target = (Local::now() + Duration::days(7))
        .format("%Y-%m-%d")
        .to_string();
    let one_day_target = (Local::now() + Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    // Check purchases
    let mut all_targets: Vec<(&str, String, &str, &str)> = Vec::new();

    if notify_7day {
        all_targets.push((
            "purchase",
            seven_day_target.clone(),
            "7day",
            "Return deadline in 7 days",
        ));
    }
    if notify_1day {
        all_targets.push((
            "purchase",
            one_day_target.clone(),
            "1day",
            "Return deadline tomorrow!",
        ));
    }

    for (entity_type, target_date, notif_type, title) in &all_targets {
        if *entity_type == "purchase" {
            let rows = sqlx::query(
                "SELECT p.id, p.item_name, r.name as retailer_name \
                 FROM purchases p \
                 LEFT JOIN retailers r ON p.retailer_id = r.id \
                 WHERE p.return_deadline = ? AND p.return_status IN ('open', 'expiring')",
            )
            .bind(target_date)
            .fetch_all(&pool)
            .await?;

            for row in rows {
                let id: i64 = row.get("id");
                let item_name: String = row.get("item_name");
                let retailer: Option<String> = row.get("retailer_name");

                // Dedup check
                let existing: Vec<(i64,)> = sqlx::query_as(
                    "SELECT id FROM notification_log WHERE entity_type = ? AND entity_id = ? AND notification_type = ?",
                )
                .bind("purchase")
                .bind(id)
                .bind(*notif_type)
                .fetch_all(&pool)
                .await?;

                if existing.is_empty() {
                    let location = retailer.map_or(String::new(), |r| format!(" at {}", r));
                    let body = format!("{}{}", item_name, location);

                    Notification::new().summary(title).body(&body).show()?;

                    sqlx::query(
                        "INSERT INTO notification_log (entity_type, entity_id, notification_type) VALUES (?, ?, ?)",
                    )
                    .bind("purchase")
                    .bind(id)
                    .bind(*notif_type)
                    .execute(&pool)
                    .await?;
                }
            }
        }
    }

    // Check rebates
    let mut rebate_targets: Vec<(String, &str, &str)> = Vec::new();
    if notify_7day {
        rebate_targets.push((
            seven_day_target.clone(),
            "7day",
            "Rebate deadline in 7 days",
        ));
    }
    if notify_1day {
        rebate_targets.push((one_day_target.clone(), "1day", "Rebate deadline tomorrow!"));
    }

    for (target_date, notif_type, title) in &rebate_targets {
        let rows = sqlx::query(
            "SELECT r.id, r.rebate_amount_cents, p.item_name \
             FROM rebates r \
             LEFT JOIN purchases p ON r.purchase_id = p.id \
             WHERE r.submission_deadline = ? AND r.submission_status IN ('pending', 'submitted')",
        )
        .bind(target_date)
        .fetch_all(&pool)
        .await?;

        for row in rows {
            let id: i64 = row.get("id");
            let amount_cents: i64 = row.get("rebate_amount_cents");
            let item_name: String = row
                .try_get("item_name")
                .unwrap_or_else(|_| "Unknown".to_string());

            let existing: Vec<(i64,)> = sqlx::query_as(
                "SELECT id FROM notification_log WHERE entity_type = ? AND entity_id = ? AND notification_type = ?",
            )
            .bind("rebate")
            .bind(id)
            .bind(*notif_type)
            .fetch_all(&pool)
            .await?;

            if existing.is_empty() {
                let amount_str = format!("${:.2}", amount_cents as f64 / 100.0);
                let body = format!("{} rebate for {}", amount_str, item_name);

                Notification::new().summary(title).body(&body).show()?;

                sqlx::query(
                    "INSERT INTO notification_log (entity_type, entity_id, notification_type) VALUES (?, ?, ?)",
                )
                .bind("rebate")
                .bind(id)
                .bind(*notif_type)
                .execute(&pool)
                .await?;
            }
        }
    }

    // Check warranties
    let mut warranty_targets: Vec<(String, &str, &str)> = Vec::new();
    if notify_7day {
        warranty_targets.push((
            seven_day_target.clone(),
            "7day",
            "Warranty expiring in 7 days",
        ));
    }
    if notify_1day {
        warranty_targets.push((one_day_target.clone(), "1day", "Warranty expires tomorrow!"));
    }

    for (target_date, notif_type, title) in &warranty_targets {
        let rows = sqlx::query(
            "SELECT id, item_name, provider FROM warranties \
             WHERE expiry_date = ? AND warranty_status IN ('active', 'expiring')",
        )
        .bind(target_date)
        .fetch_all(&pool)
        .await?;

        for row in rows {
            let id: i64 = row.get("id");
            let item_name: String = row.get("item_name");
            let provider: String = row.get("provider");

            let existing: Vec<(i64,)> = sqlx::query_as(
                "SELECT id FROM notification_log WHERE entity_type = ? AND entity_id = ? AND notification_type = ?",
            )
            .bind("warranty")
            .bind(id)
            .bind(*notif_type)
            .fetch_all(&pool)
            .await?;

            if existing.is_empty() {
                let body = format!("{} warranty for {}", provider, item_name);

                Notification::new().summary(title).body(&body).show()?;

                sqlx::query(
                    "INSERT INTO notification_log (entity_type, entity_id, notification_type) VALUES (?, ?, ?)",
                )
                .bind("warranty")
                .bind(id)
                .bind(*notif_type)
                .execute(&pool)
                .await?;
            }
        }
    }

    pool.close().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::may_install_production_agent;

    #[test]
    fn only_the_production_bundle_can_install_the_production_agent() {
        assert!(may_install_production_agent("com.returnradar.app"));
        assert!(!may_install_production_agent("com.returnradar.fixture"));
        assert!(!may_install_production_agent("com.returnradar.acceptance"));
    }
}
