# ReturnRadar

[![CI](https://github.com/saagpatel/ReturnRadar/actions/workflows/ci.yml/badge.svg)](https://github.com/saagpatel/ReturnRadar/actions/workflows/ci.yml) [![CodeQL](https://github.com/saagpatel/ReturnRadar/actions/workflows/codeql.yml/badge.svg)](https://github.com/saagpatel/ReturnRadar/actions/workflows/codeql.yml) [![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)](#) [![Rust](https://img.shields.io/badge/Rust-dea584?style=flat-square&logo=rust&logoColor=white)](#) [![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

> Every retailer gives you a return window. Almost no one tracks it — until it's too late

ReturnRadar is a local-first macOS desktop app that tracks purchase return windows, mail-in rebate deadlines, and warranty expiry dates. Log a purchase and ReturnRadar auto-calculates countdowns, shows live status badges, and fires native macOS notifications 7 days and 1 day before anything expires. No cloud. No accounts. All data in a local SQLite database.

## Features

- **Return window tracking** — log any purchase with its retailer and window length; statuses auto-transition `open → expiring → expired` as deadlines approach
- **Rebate tracking** — attach mail-in rebates to purchases, track submission status (`pending → submitted → received`), and see total recoverable dollars on the dashboard
- **Warranty tracking** — record standard, extended, or accidental damage warranties optionally linked to a logged purchase
- **On-device receipt and policy capture** — choose one image or PDF, review confidence-gated receipt facts and policy interpretations, correct ambiguity, and explicitly confirm return, rebate, warranty, or price-adjustment deadlines
- **Native notifications** — macOS system notifications fire at the 7-day and 1-day marks; a launchd login agent ensures checks run even when the app is closed
- **Pre-seeded retailers** — top 20 retailers ship with default return windows so you can log a purchase in seconds

## Quick Start

### Prerequisites

- macOS 13+ (Ventura or later; arm64 and x86_64 dependency graphs are checked,
  while CI builds the hosted runner architecture)
- Node.js 20+
- Rust stable toolchain (via [rustup](https://rustup.rs))
- Xcode Command Line Tools

### Installation

```bash
git clone https://github.com/saagpatel/ReturnRadar.git
cd ReturnRadar
npm install
```

### Usage

```bash
# Development mode
npm run tauri dev

# Run tests
npm test

# Production build
npm run tauri build
```

## Development and security

Pull requests run frontend and Rust tests, strict TypeScript and Clippy checks,
an isolated macOS fixture build, RustSec auditing, and repository-history secret
scanning. CodeQL runs once the repository is public. See the
[dependency-security policy](docs/DEPENDENCY-SECURITY.md), [receipt-capture
limitations](docs/RECEIPT-DEADLINE-CAPTURE.md), and [roadmap](IMPLEMENTATION-ROADMAP.md).

## Distribution status

The repository contains release-candidate source at version `1.0.0`; it does
not currently claim a signed, notarized, or published macOS binary. See the
[distribution runbook](docs/DISTRIBUTION.md), [privacy summary](docs/PRIVACY.md),
and [draft 1.0.0 release notes](docs/releases/v1.0.0.md). Direct-distribution
builds target macOS 13 Ventura or later.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19, TypeScript 5, Vite 6 |
| Styling | Tailwind CSS 4, shadcn/ui (Radix UI) |
| Database | SQLite via tauri-plugin-sql 2 |
| Date math | date-fns 4 |
| Receipt image OCR | macOS Vision framework, on device |
| Text PDF extraction | macOS PDFKit, on device |
| Notifications | tauri-plugin-notification + launchd login agent |
| Tests | Vitest 4, Testing Library |

## Architecture

The Rust backend validates user-selected document bytes, refuses common active/embedded PDF structures, performs image and scanned-PDF OCR with macOS Vision, and reads embedded PDF text with PDFKit. A deterministic local parser keeps receipt facts separate from policy interpretation and never writes a candidate deadline. The review flow requires a valid title and date plus an explicit per-deadline acknowledgement before one final confirmation transaction. SQLite stores only a document fingerprint, generic source label, redacted evidence spans, and correction field names with the confirmed deadline; raw document bytes and full OCR text are not retained. See [receipt capture limitations and provenance](docs/RECEIPT-DEADLINE-CAPTURE.md) and the [opt-in acceptance protocol](docs/RECEIPT-CAPTURE-ACCEPTANCE.md).

The launchd agent re-invokes the main app binary with `--check-notifications`; that headless Rust path opens SQLite with sqlx, fires native notifications for existing purchase, rebate, and warranty records, and records each firing in `notification_log` to prevent duplicates. Captured deadlines do not create notifications automatically.

## License

MIT. The included app icon set is covered by the project license; see the
[asset provenance record](docs/ASSET-PROVENANCE.md).
