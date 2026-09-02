import { invoke } from "@tauri-apps/api/core";
import { getDb } from "@/lib/db";
import { redactSensitiveText } from "./redaction";
import type { DeadlineType, EvidenceSpan } from "./types";

export interface ConfirmedDeadlineDraft {
	candidateId: string;
	type: DeadlineType;
	title: string;
	dueDate: string;
	reviewed: boolean;
	evidence: EvidenceSpan[];
	correctedFields: string[];
}

export interface ConfirmDeadlineCaptureInput {
	confirmationIntent: "confirm_and_create" | "not_confirmed";
	source: {
		fingerprint: string;
		kind: "image" | "pdf";
		extractionToken: string;
	};
	merchant: string | null;
	transactionDate: string | null;
	deadlines: ConfirmedDeadlineDraft[];
}

export interface CapturedDeadline {
	id: number;
	type: DeadlineType;
	title: string;
	merchant: string | null;
	transactionDate: string | null;
	dueDate: string;
	status: "open" | "resolved" | "expired";
	sourceLabel: string;
	confirmedAt: string;
}

interface CapturedDeadlineRow {
	id: number;
	deadline_type: DeadlineType;
	title: string;
	merchant: string | null;
	transaction_date: string | null;
	due_date: string;
	status: "open" | "resolved" | "expired";
	source_label: string;
	confirmed_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CONFIRMED_DEADLINES = 8;
export const MAX_DEADLINE_TITLE_CHARACTERS = 200;
export const MAX_MERCHANT_CHARACTERS = 200;

export function validateConfirmation(input: ConfirmDeadlineCaptureInput): void {
	if (input.confirmationIntent !== "confirm_and_create") {
		throw new Error("Explicit confirmation is required before creating a deadline.");
	}
	if (!/^[a-f0-9]{64}$/i.test(input.source.fingerprint)) {
		throw new Error("The selected document fingerprint is invalid.");
	}
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.source.extractionToken)) {
		throw new Error("The selected document extraction token is invalid.");
	}
	if (input.deadlines.length === 0) {
		throw new Error("Select at least one candidate deadline to create.");
	}
	if (input.deadlines.length > MAX_CONFIRMED_DEADLINES) {
		throw new Error(
			`Confirm no more than ${MAX_CONFIRMED_DEADLINES} deadlines at a time.`,
		);
	}
	if (
		input.merchant !== null &&
		Array.from(input.merchant.trim()).length > MAX_MERCHANT_CHARACTERS
	) {
		throw new Error(
			`Merchant must be no more than ${MAX_MERCHANT_CHARACTERS} characters.`,
		);
	}
	for (const deadline of input.deadlines) {
		if (!deadline.reviewed) {
			throw new Error("Review every selected deadline before confirming.");
		}
		const titleLength = Array.from(deadline.title.trim()).length;
		if (titleLength === 0 || titleLength > MAX_DEADLINE_TITLE_CHARACTERS) {
			throw new Error(
				`Every deadline needs a title of at most ${MAX_DEADLINE_TITLE_CHARACTERS} characters.`,
			);
		}
		if (!ISO_DATE.test(deadline.dueDate)) {
			throw new Error("Every deadline needs an explicit ISO date.");
		}
	}
}

function minimizedEvidence(evidence: EvidenceSpan[]) {
	return evidence.slice(0, 6).map((span) => ({
		page: span.page ?? 1,
		line: span.line,
		text: redactSensitiveText(span.text).slice(0, 240),
		confidence: Math.round(span.confidence * 100) / 100,
	}));
}

export async function confirmDeadlineCapture(
	input: ConfirmDeadlineCaptureInput,
): Promise<void> {
	validateConfirmation(input);
	await invoke<number>("confirm_deadline_capture", {
		input: {
			confirmationIntent: input.confirmationIntent,
			source: input.source,
			merchant: input.merchant?.trim() || null,
			transactionDate: input.transactionDate,
			deadlines: input.deadlines.map((deadline) => ({
				deadlineType: deadline.type,
				title: deadline.title.trim(),
				dueDate: deadline.dueDate,
				reviewed: deadline.reviewed,
				evidence: minimizedEvidence(deadline.evidence),
				corrections: [...new Set(deadline.correctedFields)].sort(),
			})),
		},
	});
}

export async function listCapturedDeadlines(): Promise<CapturedDeadline[]> {
	const db = await getDb();
	const rows = await db.select<CapturedDeadlineRow[]>(
		`SELECT d.id, d.deadline_type, d.title, d.merchant, d.transaction_date,
			d.due_date, d.status, d.confirmed_at, s.source_label
		 FROM captured_deadlines d
		 JOIN capture_sources s ON s.id = d.source_id
		 ORDER BY d.due_date ASC`,
	);
	return rows.map((row) => ({
		id: row.id,
		type: row.deadline_type,
		title: row.title,
		merchant: row.merchant,
		transactionDate: row.transaction_date,
		dueDate: row.due_date,
		status: row.status,
		sourceLabel: row.source_label,
		confirmedAt: row.confirmed_at,
	}));
}
