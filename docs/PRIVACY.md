# Privacy

ReturnRadar is a local-first macOS application. It does not require an account
and does not synchronize application data to a ReturnRadar service.

## Data stored on the Mac

The app stores purchases, deadlines, retailer settings, notification history,
and receipt-capture provenance in its local SQLite database. macOS Keychain may
retain a legacy Anthropic credential from older development builds; the current
receipt flow does not use or display that credential.

Receipt capture reads only the image or PDF selected by the user. Processing is
performed with macOS Vision and PDFKit. Raw document bytes, previews, private
filenames, and full OCR text are not retained after the bounded review session.
Confirmed records may retain a document fingerprint, generic document label,
redacted evidence excerpts, and the names of corrected fields. See
[Receipt-to-deadline capture](RECEIPT-DEADLINE-CAPTURE.md) for the exact limits.

## Network behavior

The application has no account, analytics, advertising, cloud-sync, or remote
receipt-processing service. Development tooling and dependency installation can
use the network, but those tools are not part of the packaged app's runtime
behavior.

## Notifications

If enabled, ReturnRadar uses macOS notification facilities to alert for locally
stored deadlines. Receipt capture does not automatically schedule a
notification. The user must confirm captured data, and notification permissions
remain controlled by macOS.

## Reports and support

Public bug reports must not include receipts, database files, screenshots with
personal data, API credentials, or other private documents. Security issues
should be reported privately using the repository's security policy.

This document describes the current source behavior. A future signed binary
release must identify its exact source revision and may require an updated
privacy review if its capabilities change.
