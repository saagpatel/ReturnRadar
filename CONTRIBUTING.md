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
npm test
npm run typecheck
npm run build
npm run release:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

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
