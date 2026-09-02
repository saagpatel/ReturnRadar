#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const failures = [];
if (!cargoVersion) failures.push("Cargo package version is missing");
if (packageJson.version !== tauriConfig.version || packageJson.version !== cargoVersion) {
  failures.push(
    `version mismatch: package=${packageJson.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion ?? "missing"}`,
  );
}
if (tauriConfig.identifier !== "com.returnradar.app") {
  failures.push(`unexpected bundle identifier: ${tauriConfig.identifier}`);
}
if (tauriConfig.bundle?.macOS?.minimumSystemVersion !== "13.0") {
  failures.push("macOS minimumSystemVersion must be 13.0");
}
if (tauriConfig.bundle?.macOS?.hardenedRuntime !== true) {
  failures.push("macOS hardenedRuntime must be enabled");
}
const targets = tauriConfig.bundle?.targets;
if (!Array.isArray(targets) || !targets.includes("app") || !targets.includes("dmg")) {
  failures.push("bundle targets must include app and dmg");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`release metadata: ${failure}`);
  process.exit(1);
}

console.log(
  `release metadata: ok version=${packageJson.version} identifier=${tauriConfig.identifier} macOS>=${tauriConfig.bundle.macOS.minimumSystemVersion}`,
);
NODE
