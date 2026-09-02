export type ReceiptConfidence = "high" | "medium" | "low";

export type DeadlineType =
	| "return"
	| "rebate"
	| "warranty"
	| "price_adjustment";

export type ExtractionIssueCode =
	| "missing"
	| "conflicting"
	| "locale_ambiguous"
	| "ocr_low_confidence"
	| "policy_not_found"
	| "multiple_deadlines"
	| "unsupported_document"
	| "unsafe_document";

export type CandidateState =
	| "ready_for_confirmation"
	| "needs_correction"
	| "refused";

export interface OcrLine {
	text: string;
	confidence: number;
	page?: number;
	boundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

export interface EvidenceSpan {
	line: number;
	page?: number;
	start: number;
	end: number;
	text: string;
	confidence: number;
}

export interface ExtractionIssue {
	code: ExtractionIssueCode;
	field: string;
	message: string;
	evidence: EvidenceSpan[];
}

export interface ExtractedField<T> {
	value: T | null;
	confidence: number;
	confidenceLabel: ReceiptConfidence;
	evidence: EvidenceSpan[];
	issues: ExtractionIssue[];
}

export interface ReceiptItemFact {
	name: ExtractedField<string>;
	priceDollars: ExtractedField<string>;
}

export interface ReceiptFacts {
	merchant: ExtractedField<string>;
	transactionDate: ExtractedField<string>;
	items: ReceiptItemFact[];
}

export interface PolicyInterpretation {
	type: DeadlineType;
	windowDays: number | null;
	windowUnit: "days" | "months" | "years" | null;
	windowAnchor:
		| "transaction_date"
		| "delivery_date"
		| "shipment_date"
		| "installation_date"
		| "manufacture_date"
		| "activation_date"
		| "registration_date"
		| "receipt_date"
		| "replacement_date"
		| "exchange_date"
		| "prior_policy_expiration_date";
	explicitDate: string | null;
	description: string;
	exclusions: string[];
	itemQualificationRequired: boolean;
	confidence: number;
	confidenceLabel: ReceiptConfidence;
	evidence: EvidenceSpan[];
	issues: ExtractionIssue[];
}

export interface DeadlineCandidate {
	id: string;
	type: DeadlineType;
	label: string;
	itemName: string | null;
	candidateDate: string | null;
	confidence: number;
	confidenceLabel: ReceiptConfidence;
	state: CandidateState;
	evidence: EvidenceSpan[];
	issues: ExtractionIssue[];
}

export interface ReceiptCaptureResult {
	schema: "ReceiptCaptureResultV1";
	source: {
		fingerprint: string;
		kind: "image" | "pdf" | "fixture";
		pageCount: number;
		rawContentRetained: false;
	};
	receiptFacts: ReceiptFacts;
	policyInterpretations: PolicyInterpretation[];
	candidates: DeadlineCandidate[];
	issues: ExtractionIssue[];
	overallState: CandidateState;
	processingMs: number;
}

export interface CaptureFixtureExpectation {
	merchant?: string | null;
	transactionDate?: string | null;
	itemNames?: string[];
	candidates?: Array<{
		type: DeadlineType;
		date: string;
	}>;
	state: CandidateState;
	requiredIssues?: ExtractionIssueCode[];
	maxCorrectionFields: number;
	candidateConfidence?: { min: number; max: number };
}

export interface CaptureFixture {
	id: string;
	description: string;
	locale?: string;
	documentKind: "image" | "pdf" | "fixture";
	lines: OcrLine[];
	expect: CaptureFixtureExpectation;
}
