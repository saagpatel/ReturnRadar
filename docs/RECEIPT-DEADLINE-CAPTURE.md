# Receipt-to-deadline capture

ReturnRadar's capture flow is an assistive, local review tool. It is not legal advice and does not claim that a merchant policy is current, complete, or generally correct.

## Trust boundary

- The app reads only the image or PDF the user selects. It has no API for a document path and does not scan Downloads, Photos, Mail, browsers, cloud storage, or private accounts.
- PNG, JPEG, and WebP images are decoded and recognized on device with the macOS Vision framework. PDFs are parsed from in-memory bytes with PDFKit; pages without embedded text are rendered locally and passed to Vision.
- Common active, embedded, remote, form, encoded-name, and opaque object-stream PDF markers are refused before read-only PDFKit processing. When browser MIME metadata is absent, a supported filename extension may select the native decoder, but the native boundary still verifies the actual file signature. MIME/signature mismatches, malformed inputs, encrypted PDFs, files over 12 MB, PDFs over 25 pages, and extracted text over 500,000 characters are refused. This defense-in-depth scan is not a general PDF malware detector.
- Documents are not uploaded and no paid OCR or merchant service is called. The former Anthropic renderer integration and API-key setting were removed.
- Prompt-like text in a document is inert input. The deterministic parser recognizes only bounded receipt and policy shapes.

## Confidence and confirmation

Receipt facts (merchant, transaction date, and item candidates) remain distinct from policy interpretations (deadline type, policy window or explicit date, exclusions, and evidence).

The parser represents missing facts, conflicting values, locale-ambiguous dates, low-confidence OCR, absent policy, exclusions, and multiple deadline interpretations. Blocking ambiguity lowers candidate confidence and returns `needs_correction`; absent policy returns `refused`. Retailer defaults are never promoted to policy evidence.

Every selected candidate requires:

1. a user-visible deadline type, title, and ISO date;
2. explicit resolution of any extraction warning before review;
3. an explicit `Reviewed` acknowledgement after the last correction; and
4. the final `Confirm and create` action.

Low-confidence, missing, conflicting, or locale-ambiguous receipt facts have a separate explicit resolution gate. Candidate review alone cannot bypass a warning attached to merchant, transaction date, or item evidence.

The persistence layer rejects any call without the exact confirmation intent or with an unreviewed candidate. The database write is transactional, so a multi-deadline confirmation either completes as a unit or rolls back.

## Provenance and retention

`capture_sources` stores a native-computed SHA-256 fingerprint, document kind, and generic label such as `PDF • a1b2c3d4e5`. It never stores a private filename or raw content. Native extraction also issues a bounded, one-time session token; confirmation must present the matching token, fingerprint, and document kind, so a frontend payload cannot invent provenance for a document that was never extracted in the current app session.

`captured_deadlines` stores the confirmed type, title, merchant, transaction date, due date, redacted supporting evidence, and the names of fields the user corrected. Evidence is capped at six short spans per deadline. Payment-card fragments, street addresses, loyalty identifiers, and transaction identifiers are redacted before persistence.

Raw bytes and their base64 transport copy are released immediately after the bounded native extraction invocation returns; the JavaScript byte buffer is also overwritten. Closing the review prevents any late extraction result from being displayed or persisted, although an already-running local Vision/PDFKit worker may finish before its temporary invocation buffers are released. Full OCR text and image previews remain in memory only for the open review and are discarded when it closes. Private documents never become parser fixtures or training material.

Fixture/acceptance bundle identifiers are rejected at the native notification boundary, so an isolated build cannot replace the production launch agent even if its frontend notification flag is omitted. The checked-in fixture configuration also compiles into a separate `dist-fixture` tree with notifications disabled and uses `return_radar_fixture.db` inside the fixture bundle's separate application-data container. Users upgrading from the former cloud parser can inspect and remove its legacy Anthropic credential from Settings without exposing the secret to the UI.

## Frozen evaluation corpus

The project-owned text corpus lives in `src/test-fixtures/receipt-capture/corpus.ts`. Two image-only native PDF fixtures live in `output/pdf/`: `synthetic-runtime-receipt.pdf` exercises a ready-for-confirmation return, while `synthetic-ambiguous-date-runtime-receipt.pdf` freezes an unresolved `03/04/2026` transaction date that must never become a deadline without correction. The 37 text fixtures cover:

- multiple invented merchants;
- US, UK, Canadian, and German locale/date shapes, including an ambiguous transaction date mixed with an unrelated unambiguous date;
- multi-item receipts;
- category exclusions and final-sale text;
- holiday extensions with conflicting and missing eligibility evidence;
- rebate, warranty, return, and price-adjustment deadlines;
- missing and ambiguous dates;
- poor OCR and handwritten annotations;
- scanned-PDF OCR and medium-confidence calibration;
- Australian and deliberately ambiguous Canadian numeric dates;
- co-located receipt and policy dates;
- contradictory policy text;
- policy-not-found and prompt-like refusal cases.

The evaluator measures field accuracy, deadline accuracy, confidence Brier score, refusal precision and recall, correction-field effort, and parser p95 latency. Field accuracy compares the complete expected/actual item-name set, and deadline accuracy compares the complete union of expected and actual dated candidates, so missing and unexpected results both reduce their scores. Thresholds are frozen in `src/lib/receipt-capture/extract.test.ts`.

For native acceptance, import both checked-in PDFs through the file picker. The ready fixture should produce Northstar Outfitters, transaction date `2026-01-15`, and a return candidate dated `2026-02-14`. The ambiguous fixture should produce Atlas Goods and the 30-day return policy while leaving the transaction date and derived deadline unresolved until the reviewer supplies an unambiguous date. In both flows, global navigation and creation shortcuts must remain inactive while the capture dialog is open, each candidate control must have a unique accessible name, and corrections must clear the candidate's `Reviewed` acknowledgement.

## Explicit limitations

- Image OCR quality depends on macOS Vision and the selected image. Low-confidence evidence must be corrected.
- Scanned-PDF OCR is bounded to 25 locally rendered pages. Dense or low-quality scans may be slower or require correction. PDF text layers are conservatively treated as low-confidence because PDFKit cannot distinguish authored text from prior OCR.
- The deterministic parser intentionally supports a bounded set of English policy phrases and common numeric/month-name dates. Other languages and uncommon policy wording may require manual entry.
- The app does not use the Mac's locale as evidence of the selected document's locale. Ambiguous numeric dates and all two-digit years must be corrected explicitly.
- Unparsed explicit-date alternatives and conflicting denial language remain blocked rather than falling back to a usable window.
- Delivery-, shipment-, installation-, and receipt-anchored windows require that separate anchor date; the parser never substitutes the transaction date.
- Category exclusions cannot be reliably matched to arbitrary line items and therefore require user judgment.
- Holiday extensions remain conflicting interpretations unless the selected document itself establishes eligibility.
- Confirmed captured deadlines are shown inside ReturnRadar but do not automatically schedule notifications or mutate existing purchase, rebate, or warranty records.
- No result proves a merchant's current policy or a user's legal rights. Users should verify consequential deadlines against the original document or merchant.

Human evaluation follows the [opt-in acceptance protocol](RECEIPT-CAPTURE-ACCEPTANCE.md). Private documents are never promoted into fixtures or retained as evaluation artifacts.

The implementation relies on Apple's documented on-device text recognition and PDF text access: [Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images) and [PDFDocument text](https://developer.apple.com/documentation/pdfkit/pdfdocument/string).
