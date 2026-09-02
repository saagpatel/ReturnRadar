#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CONFIG="$ROOT_DIR/src-tauri/tauri.fixture.conf.json"
FIXTURE_DIST="$ROOT_DIR/dist-fixture"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT_DIR/src-tauri/target}"
APP_BUNDLE="$TARGET_DIR/debug/bundle/macos/Return Radar Fixture.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/return-radar"
BUNDLE_ID="com.returnradar.fixture"
FIXTURE_DB_URL="sqlite:return_radar_fixture.db"

stop_fixture() {
	local pid
	while IFS= read -r pid; do
		if [[ -n "$pid" ]]; then
			kill "$pid" >/dev/null 2>&1 || true
		fi
	done < <(pgrep -f "^${APP_BINARY}$" || true)
}

build_fixture() {
	cd "$ROOT_DIR"
	VITE_RETURNRADAR_DB_URL="$FIXTURE_DB_URL" \
		VITE_RETURNRADAR_DISABLE_NOTIFICATIONS=true \
		npm run tauri -- build --debug --bundles app --config "$TAURI_CONFIG"
}

verify_fixture_assets() {
	if ! grep -R -F -q --include='*.js' "$FIXTURE_DB_URL" "$FIXTURE_DIST/assets"; then
		echo "Fixture frontend is not bound to $FIXTURE_DB_URL" >&2
		exit 1
	fi
	if grep -R -F -q --include='*.js' 'sqlite:return_radar.db' "$FIXTURE_DIST/assets"; then
		echo "Fixture frontend contains the production database binding" >&2
		exit 1
	fi
	if grep -R -F -q --include='*.js' 'requestPermission' "$FIXTURE_DIST/assets"; then
		echo "Fixture frontend contains notification-permission code" >&2
		exit 1
	fi
}

open_fixture() {
	/usr/bin/open -n "$APP_BUNDLE"
}

stop_fixture
build_fixture
verify_fixture_assets

case "$MODE" in
	run)
		open_fixture
		;;
	--debug|debug)
		lldb -- "$APP_BINARY"
		;;
	--logs|logs)
		open_fixture
		/usr/bin/log stream --info --style compact --predicate 'process == "return-radar"'
		;;
	--telemetry|telemetry)
		open_fixture
		/usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
		;;
	--verify|verify)
		open_fixture
		for _ in {1..20}; do
			if pgrep -f "^${APP_BINARY}$" >/dev/null; then
				exit 0
			fi
			sleep 0.25
		done
		echo "Return Radar Fixture did not start from $APP_BUNDLE" >&2
		exit 1
		;;
	*)
		echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
		exit 2
		;;
esac
