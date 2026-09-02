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
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT

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
done

cargo audit --file "$LOCKFILE" --ignore RUSTSEC-2023-0071
