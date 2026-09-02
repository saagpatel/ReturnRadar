# macOS distribution

ReturnRadar's source is public, but a distributable application is a separate
release artifact. A public Git tag or source archive is not evidence that a
macOS binary was signed, notarized, stapled, or accepted by Gatekeeper.

## Supported release target

- Direct distribution outside the Mac App Store.
- macOS 13 Ventura or later.
- Application identifier `com.returnradar.app`.
- Hardened runtime enabled.
- Application and DMG bundles produced by Tauri.
- One universal binary containing Apple silicon and Intel slices.

The App Store sandbox is not enabled. ReturnRadar uses a local SQLite database,
native notifications, and a login-agent notification path that must be reviewed
separately before any future App Store distribution attempt.

## Local release candidate

Run the normal quality checks first:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run release:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
bash script/check_rustsec.sh
```

Create a Developer ID signed app candidate without submitting it for
notarization:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: YOUR NAME (TEAMID)" \
  npm run tauri -- build --target universal-apple-darwin --bundles app
npm run release:verify-bundle -- \
  "src-tauri/target/universal-apple-darwin/release/bundle/macos/Return Radar.app" \
  developer-id universal
```

Do not commit certificate exports, App Store Connect keys, Apple IDs,
app-specific passwords, or keychain material. CI secrets must be configured only
when an authorized release workflow is added.

## Notarization gate

Notarization requires separately authorized Apple authentication. Before a
public binary release:

1. build from the exact intended Git tag;
2. sign with a valid Developer ID Application identity;
3. submit the exact DMG or archived app to Apple's notary service;
4. require an accepted notarization result;
5. staple the ticket and validate it;
6. run `spctl --assess --type execute --verbose=4` against the stapled app;
7. publish checksums that are computed from the final artifacts.

Do not retry or publish after an ambiguous notarization response until the
submission history has been read back and the exact artifact is identified.

## Rollback

GitHub Releases are immutable release records from the project's perspective;
do not replace an existing version's binary in place. If a candidate is faulty,
keep it unpublished. If a published release must be withdrawn, mark it clearly,
remove it from the recommended download path, repair on a new version, and keep
the original checksums and incident record for traceability.

## Data backup and application rollback

Before upgrading, quit ReturnRadar and back up its SQLite database from:

```text
~/Library/Application Support/com.returnradar.app/return_radar.db
```

Use SQLite's online backup command rather than copying a database that may have
an active write-ahead log:

```bash
sqlite3 "$HOME/Library/Application Support/com.returnradar.app/return_radar.db" \
  ".backup '/absolute/private/backup/path/return_radar.db'"
sqlite3 "/absolute/private/backup/path/return_radar.db" "PRAGMA integrity_check;"
```

Keep backups outside the application-data directory and protect them as private
purchase data. Restoring a backup replaces current app data, so preserve the
current database first and restore only while ReturnRadar is closed.

Reinstalling an older app does not reverse database migrations. If an upgrade
changes the schema, application rollback requires the pre-upgrade database
backup that belongs to that version. No downgrade compatibility claim should be
made without exercising that exact version pair against disposable data.
