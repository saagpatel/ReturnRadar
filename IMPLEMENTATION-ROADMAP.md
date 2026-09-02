# ReturnRadar roadmap

ReturnRadar is a local-first macOS app. The repository is currently versioned
`1.0.0`; roadmap labels describe product milestones rather than published
binary releases.

## Current source

- Purchase return-window tracking with retailer defaults and live status.
- Rebate and warranty deadline tracking.
- Duplicate-suppressed native deadline notifications.
- User-selected image and PDF capture using macOS Vision and PDFKit.
- Confidence-gated review and explicit confirmation before captured deadlines
  are persisted.
- Local SQLite storage with no accounts or cloud synchronization.

## Repository maintenance

- Keep pull-request CI green across frontend tests, TypeScript, Rust tests,
  Clippy, RustSec, secret scanning, and the isolated macOS fixture build.
- Keep CodeQL and dependency updates active on the public repository.
- Review warning-class dependency advisories during routine upgrades and retain
  the fail-closed proof around any advisory exception.
- Keep public documentation and asset provenance aligned with shipped source.

## Next product milestone

- Complete the opt-in manual acceptance protocol on a supported macOS desktop.
- Improve scanned-PDF feedback and recovery without retaining source documents.
- Add focused accessibility regression coverage for the receipt correction and
  confirmation flow.
- Prepare a signed and notarized macOS release with reproducible release notes.

## Product boundaries

ReturnRadar does not scan folders, email, browser history, or online accounts.
It does not provide legal advice or guarantee a merchant's current policy. A
candidate date never creates a reminder or database record until the user
reviews and confirms it.

Raw document bytes and full OCR text are not retained. Publication of the
source repository is separate from publishing a signed application binary.
