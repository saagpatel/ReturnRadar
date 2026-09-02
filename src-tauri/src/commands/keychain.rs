use keyring::Entry;

const SERVICE_NAME: &str = "com.returnradar.app";
const LEGACY_API_KEY_ACCOUNT: &str = "anthropic_api_key";

fn may_access_legacy_credential(identifier: &str) -> bool {
    identifier == SERVICE_NAME
}

fn legacy_api_key_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, LEGACY_API_KEY_ACCOUNT)
        .map_err(|error| format!("Keychain error: {error}"))
}

#[tauri::command]
pub async fn has_legacy_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    if !may_access_legacy_credential(&app.config().identifier) {
        return Ok(false);
    }

    match legacy_api_key_entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("Failed to inspect the legacy credential: {error}")),
    }
}

#[tauri::command]
pub async fn delete_legacy_api_key(app: tauri::AppHandle) -> Result<(), String> {
    if !may_access_legacy_credential(&app.config().identifier) {
        return Err("Legacy credential cleanup is only available in Return Radar.".to_string());
    }

    match legacy_api_key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete the legacy credential: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::may_access_legacy_credential;

    #[test]
    fn fixture_bundles_cannot_access_the_production_credential() {
        assert!(may_access_legacy_credential("com.returnradar.app"));
        assert!(!may_access_legacy_credential("com.returnradar.fixture"));
        assert!(!may_access_legacy_credential("com.returnradar.acceptance"));
    }
}
