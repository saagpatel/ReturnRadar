# Contributing

Thanks for your interest in contributing! Here's how to get started.

## Bug Reports & Feature Requests

Open a [GitHub Issue](../../issues/new) with:
- Clear description of the problem or idea
- Steps to reproduce (for bugs)
- Expected vs actual behavior

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Make your changes with clear commit messages
4. Run existing tests to ensure nothing breaks
5. Open a PR with a description of what changed and why

## Development Setup

See the README for installation and setup instructions. Before opening a pull
request, run:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run release:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
```

Run from the repository root. The checked-in `package-lock.json` and CI use npm;
`make install/build/test` delegate to those npm commands. `make lint` runs Rust
Clippy; there is no frontend lint script. Native tests/builds require macOS 13+
and Xcode Command Line Tools (Vision/PDFKit are native macOS dependencies).
For a focused fixture check, use `npm test -- src/lib/deadlines.test.ts` or the
relevant receipt-capture test file. Tests mock native APIs and use synthetic
fixtures; never substitute a private receipt/database.

For changed UI or receipt reports, use the isolated app configuration after the
unit/type checks:

```bash
VITE_RETURNRADAR_DB_URL=sqlite:return_radar_fixture.db \
VITE_RETURNRADAR_DISABLE_NOTIFICATIONS=true \
  npm run tauri -- build --debug --bundles app --config src-tauri/tauri.fixture.conf.json
```

This builds `Return Radar Fixture.app` with the fixture identifier/database and
notifications disabled, without launching it. If manually opening it, use only
the synthetic inputs and acceptance checks in
[receipt-capture limitations](docs/RECEIPT-DEADLINE-CAPTURE.md#frozen-evaluation-corpus).
The ordinary `npm run tauri dev` uses the production app identity and can write
personal data/use notifications. `script/build_and_run.sh` also stops/opens the
fixture process, so it is not a read-only verification command. Documentation
changes need no app launch. See the [distribution runbook](docs/DISTRIBUTION.md)
for broader native/audit/bundle checks; signing/notarization are separate lanes.

Changes to receipt capture should include focused adversarial tests and must
preserve the confirmation and local-data boundaries documented in
`docs/RECEIPT-DEADLINE-CAPTURE.md`.

## Code Style

- Follow the existing patterns in the codebase
- Use meaningful variable and function names
- Add comments only where the logic isn't self-evident

## Security and private data

Do not attach private receipts, databases, credentials, or screenshots with
personal information to issues or pull requests. Report vulnerabilities using
the private channel in `SECURITY.md`.

## Questions?

Open an issue or start a discussion. Maintainer response times are not
guaranteed.
