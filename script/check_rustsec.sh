#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT_DIR/src-tauri/Cargo.toml"
LOCKFILE="$ROOT_DIR/src-tauri/Cargo.lock"
HOST_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
TARGETS=(aarch64-apple-darwin x86_64-apple-darwin)

if [[ "$HOST_TARGET" != *-apple-darwin ]]; then
	echo "check_rustsec.sh must run on macOS; got $HOST_TARGET" >&2
	exit 1
fi

# RUSTSEC-2023-0071 has no patched rsa release. It is resolved into Cargo.lock
# through sqlx's optional MySQL feature, but ReturnRadar supports SQLite only.
# Keep the exception fail-closed by proving rsa is absent from the active target
# graph every time the audit runs.
#
# RUSTSEC-2024-0429 (glib) and RUSTSEC-2026-0097 (rand) are warning-class
# advisories in cargo-audit, but GitHub also reports them as dependency alerts.
# The locked glib line is Linux-only for this macOS app. The locked rand 0.7
# line is build-only, and the advisory's optional `log` feature is disabled.
# Pin these assumptions to both supported target graphs so dependency drift
# fails CI and requires a fresh review.
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT

AUDIT_JSON_FILE="$CHECK_DIR/audit.json"
if ! cargo audit --file "$LOCKFILE" --ignore RUSTSEC-2023-0071 --json >"$AUDIT_JSON_FILE"; then
	echo "RustSec found a release-blocking advisory" >&2
	cargo audit --file "$LOCKFILE" --ignore RUSTSEC-2023-0071 --no-fetch >&2 || true
	exit 1
fi

audit_package_ids() {
	node - "$AUDIT_JSON_FILE" "$1" <<'NODE'
const fs = require("node:fs");

const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const advisoryId = process.argv[3];
const entries = [
  ...Object.values(report.warnings ?? {}).flat(),
  ...(report.vulnerabilities?.list ?? []),
];
const packageIds = new Set(
  entries
    .filter((entry) => entry.advisory?.id === advisoryId)
    .map((entry) => `${entry.package.name}@${entry.package.version}`),
);

for (const packageId of [...packageIds].sort()) {
  console.log(packageId);
}
NODE
}

GLIB_PACKAGE_IDS=()
GLIB_PACKAGE_IDS_FILE="$CHECK_DIR/glib-package-ids.txt"
if ! audit_package_ids RUSTSEC-2024-0429 >"$GLIB_PACKAGE_IDS_FILE"; then
	echo "Unable to parse affected packages for RUSTSEC-2024-0429" >&2
	exit 1
fi
while IFS= read -r package_id; do
	if [[ -n "$package_id" ]]; then
		GLIB_PACKAGE_IDS+=("$package_id")
	fi
done <"$GLIB_PACKAGE_IDS_FILE"

RAND_PACKAGE_IDS=()
RAND_PACKAGE_IDS_FILE="$CHECK_DIR/rand-package-ids.txt"
if ! audit_package_ids RUSTSEC-2026-0097 >"$RAND_PACKAGE_IDS_FILE"; then
	echo "Unable to parse affected packages for RUSTSEC-2026-0097" >&2
	exit 1
fi
while IFS= read -r package_id; do
	if [[ -n "$package_id" ]]; then
		RAND_PACKAGE_IDS+=("$package_id")
	fi
done <"$RAND_PACKAGE_IDS_FILE"

for target in "${TARGETS[@]}"; do
	rsa_tree_file="$CHECK_DIR/rsa-$target.txt"
	rsa_error_file="$CHECK_DIR/rsa-$target.err"
	if ! cargo tree --manifest-path "$MANIFEST" --locked --target "$target" -i rsa >"$rsa_tree_file" 2>"$rsa_error_file"; then
		echo "Unable to prove that rsa is inactive for $target" >&2
		cat "$rsa_error_file" >&2
		exit 1
	fi

	if [[ -s "$rsa_tree_file" ]]; then
		echo "RUSTSEC-2023-0071 exception is invalid: rsa is active for $target" >&2
		cat "$rsa_tree_file" >&2
		exit 1
	fi

	for package_id in "${GLIB_PACKAGE_IDS[@]}"; do
		glib_tree_file="$CHECK_DIR/$package_id-$target.txt"
		glib_error_file="$CHECK_DIR/$package_id-$target.err"
		if ! cargo tree --manifest-path "$MANIFEST" --locked --target "$target" -i "$package_id" >"$glib_tree_file" 2>"$glib_error_file"; then
			echo "Unable to prove the RUSTSEC-2024-0429 target exception for $package_id on $target" >&2
			cat "$glib_error_file" >&2
			exit 1
		fi

		if [[ -s "$glib_tree_file" ]]; then
			echo "RUSTSEC-2024-0429 exception is invalid: $package_id is active for $target" >&2
			cat "$glib_tree_file" >&2
			exit 1
		fi
	done

	for package_id in "${RAND_PACKAGE_IDS[@]}"; do
		rand_nonbuild_tree_file="$CHECK_DIR/$package_id-nonbuild-$target.txt"
		rand_nonbuild_error_file="$CHECK_DIR/$package_id-nonbuild-$target.err"
		if ! cargo tree --manifest-path "$MANIFEST" --locked --target "$target" -e normal,dev -i "$package_id" >"$rand_nonbuild_tree_file" 2>"$rand_nonbuild_error_file"; then
			echo "Unable to prove the RUSTSEC-2026-0097 build-only exception for $package_id on $target" >&2
			cat "$rand_nonbuild_error_file" >&2
			exit 1
		fi

		if [[ -s "$rand_nonbuild_tree_file" ]]; then
			echo "RUSTSEC-2026-0097 exception is invalid: $package_id has a normal or development dependency edge for $target" >&2
			cat "$rand_nonbuild_tree_file" >&2
			exit 1
		fi

		rand_feature_tree_file="$CHECK_DIR/$package_id-features-$target.txt"
		rand_feature_error_file="$CHECK_DIR/$package_id-features-$target.err"
		if ! cargo tree --manifest-path "$MANIFEST" --locked --target "$target" -e features -i "$package_id" >"$rand_feature_tree_file" 2>"$rand_feature_error_file"; then
			echo "Unable to prove the RUSTSEC-2026-0097 feature exception for $package_id on $target" >&2
			cat "$rand_feature_error_file" >&2
			exit 1
		fi

		if ! grep -Fq '[build-dependencies]' "$rand_feature_tree_file"; then
			echo "RUSTSEC-2026-0097 exception is invalid: $package_id is not proven build-only for $target" >&2
			cat "$rand_feature_tree_file" >&2
			exit 1
		fi

		if grep -Fq 'rand feature "log"' "$rand_feature_tree_file"; then
			echo "RUSTSEC-2026-0097 exception is invalid: $package_id enables the vulnerable log feature for $target" >&2
			cat "$rand_feature_tree_file" >&2
			exit 1
		fi
	done
done

cargo audit --file "$LOCKFILE" --ignore RUSTSEC-2023-0071 --no-fetch
