mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::document_capture::CaptureSessionRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::deadline_capture::confirm_deadline_capture,
            commands::document_capture::extract_document_text,
            commands::keychain::has_legacy_api_key,
            commands::keychain::delete_legacy_api_key,
            commands::notifications::notification_setup_allowed,
            commands::notifications::install_launchd_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub use commands::notifications::check_notifications_headless;
