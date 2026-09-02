// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.contains(&"--check-notifications".to_string()) {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        match rt.block_on(return_radar_lib::check_notifications_headless()) {
            Ok(()) => std::process::exit(0),
            Err(e) => {
                eprintln!("Notification check failed: {}", e);
                std::process::exit(1);
            }
        }
    }

    return_radar_lib::run()
}
