#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-src-tauri/target/release/bundle/macos/Return Radar.app}"
expected_signing="${2:-any}"
expected_architecture="${3:-any}"

if [[ ! -d "$app_path" ]]; then
  echo "bundle verification: app not found: $app_path" >&2
  exit 1
fi

info_plist="$app_path/Contents/Info.plist"
executable="$app_path/Contents/MacOS/return-radar"
if [[ ! -f "$info_plist" || ! -x "$executable" ]]; then
  echo "bundle verification: incomplete bundle structure" >&2
  exit 1
fi

identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist")"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist")"
minimum="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$info_plist")"

[[ "$identifier" == "com.returnradar.app" ]] || {
  echo "bundle verification: unexpected identifier: $identifier" >&2
  exit 1
}
[[ "$version" == "1.0.0" ]] || {
  echo "bundle verification: unexpected version: $version" >&2
  exit 1
}
[[ "$minimum" == "13.0" ]] || {
  echo "bundle verification: unexpected minimum system version: $minimum" >&2
  exit 1
}

codesign --verify --deep --strict --verbose=2 "$app_path"
signature="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
if ! grep -q '^Runtime Version=' <<<"$signature"; then
  echo "bundle verification: hardened runtime signature is missing" >&2
  exit 1
fi

case "$expected_signing" in
  any)
    ;;
  adhoc)
    grep -q '^Signature=adhoc$' <<<"$signature" || {
      echo "bundle verification: expected an ad hoc signature" >&2
      exit 1
    }
    ;;
  developer-id)
    grep -q '^Authority=Developer ID Application:' <<<"$signature" || {
      echo "bundle verification: expected a Developer ID Application signature" >&2
      exit 1
    }
    ;;
  *)
    echo "bundle verification: expected signing mode must be any, adhoc, or developer-id" >&2
    exit 1
    ;;
esac

architectures="$(lipo -archs "$executable")"
case "$expected_architecture" in
  any)
    ;;
  universal)
    for architecture in arm64 x86_64; do
      grep -Eq "(^| )${architecture}( |$)" <<<"$architectures" || {
        echo "bundle verification: missing $architecture slice: $architectures" >&2
        exit 1
      }
    done
    ;;
  arm64|x86_64)
    [[ "$architectures" == "$expected_architecture" ]] || {
      echo "bundle verification: expected $expected_architecture, found $architectures" >&2
      exit 1
    }
    ;;
  *)
    echo "bundle verification: expected architecture must be any, universal, arm64, or x86_64" >&2
    exit 1
    ;;
esac

echo "bundle verification: ok identifier=$identifier version=$version macOS>=$minimum signing=$expected_signing architectures=$architectures"
