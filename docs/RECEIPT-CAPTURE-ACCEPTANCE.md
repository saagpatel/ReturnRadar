# Opt-in receipt capture acceptance protocol

This protocol measures whether ReturnRadar's local review flow helps real people without turning private documents into fixtures, logs, or training data. It does not validate a merchant's policy or provide legal advice.

## Preconditions

- The participant deliberately chooses each document through ReturnRadar's file picker and may stop before confirmation.
- Use a dedicated local acceptance database with notifications disabled. Do not use a production or personal ReturnRadar database.
- Do not scan folders, accounts, Mail, browsers, Photos, cloud storage, or clipboard history.
- Do not screen-record, screenshot, copy, upload, or retain the selected document, full OCR text, merchant identifiers, filenames, or free-form participant notes.
- Do not convert a participant document into a fixture. Reproduce any parser defect later with newly written synthetic text.

## Session

For each deliberately selected document:

1. Ask the participant to verify that the source picker shows only the chosen file.
2. Record local extraction latency and the document kind only.
3. Have the participant compare receipt facts and policy interpretations with the source.
4. Count accepted fields, corrected fields, refused candidates, and any candidate that appeared more confident than its evidence justified.
5. If the participant chooses to confirm, use the isolated acceptance database and verify that the review acknowledgement and final confirmation are both required.
6. Close the review. Verify that no raw bytes, full OCR text, or private filename are present in logs or the acceptance database.
7. Delete the isolated acceptance database after its aggregate receipt is recorded and the participant approves cleanup.

## Aggregate receipt

Record only this bounded shape; omit fields that could identify a person, merchant, item, address, account, or transaction:

```json
{
  "schema": "ReceiptCaptureAcceptanceV1",
  "consentConfirmed": true,
  "documentsSelected": 0,
  "imageDocuments": 0,
  "pdfDocuments": 0,
  "candidatesPresented": 0,
  "candidatesConfirmed": 0,
  "fieldsAccepted": 0,
  "fieldsCorrected": 0,
  "refusals": 0,
  "falseConfidenceIncidents": 0,
  "latencyP50Ms": null,
  "latencyP95Ms": null,
  "rawContentRetained": false,
  "privateIdentifiersRecorded": false
}
```

## Advancement thresholds

- Zero false-confidence incidents.
- Zero raw-content or private-identifier retention.
- Every created deadline requires both per-deadline review and final confirmation.
- Refusals and corrections are acceptable; silent guessing is not.
- Report field acceptance, correction effort, refusal rate, and latency without claiming general policy correctness.

A synthetic dry run proves only that the protocol and instrumentation shape are usable. Human acceptance remains `UNKNOWN` until a participant deliberately supplies documents and the aggregate receipt is produced.
