import { addDays, addMonths, addYears, format, isValid, parse } from "date-fns";
import { redactSensitiveText } from "./redaction";
import type {
	CandidateState,
	DeadlineCandidate,
	DeadlineType,
	EvidenceSpan,
	ExtractedField,
	ExtractionIssue,
	OcrLine,
	PolicyInterpretation,
	ReceiptCaptureResult,
	ReceiptConfidence,
	ReceiptItemFact,
} from "./types";

const LOW_OCR_THRESHOLD = 0.7;
const RETURN_POLICY_KEYWORDS =
	/\b(return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|final sale|all\s+sales?\s+(?:are\s+)?final)\b/i;
const OPERATIVE_RETURN_DEADLINE_PATTERN =
	/\b(?:may|can|must|should)\s+be\s+(?:returned|refunded|exchanged)\s+(?:within|until|through|before|by)\b|\b(?:returns?|refunds?|exchanges?)\s+(?:(?:are|is|must\s+be|should\s+be|can\s+be|may\s+be)\s+)?(?:accepted|allowed|available|offered|eligible)?\s*(?:within|until|through|before|by)\b|\b(?:return(?:ed)?|refund(?:ed)?|exchange(?:d)?)\s+(?:within|until|through|before|by)\b/i;
const POLICY_KEYWORDS =
	/\b(return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment)|final sale|all\s+sales?\s+(?:are\s+)?final)\b/i;
const HOLIDAY_POLICY_PATTERN =
	/\bholiday\b(?=.{0,60}\b(?:return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|extension|extended|deadline|until|through)\b)|\b(?:return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|extension|extended|deadline)\b(?=.{0,60}\bholiday\b)/i;
const NON_ITEM_PATTERN =
	/\b(subtotal|total|tax|change|cash|visa|mastercard|amex|payment|balance|transaction|order|receipt|loyalty|member)\b/i;
const POLICY_EXCLUSION_PATTERN =
	/\b(final sale|all\s+sales?\s+(?:are\s+)?final|non-?returnable|(?:not|never)\s+returnable|(?:not\s+eligible|ineligible)\s+for\s+(?:a\s+)?(?:returns?|refunds?|exchanges?)|(?:(?:can(?:not|['’]t)|may\s+not|must\s+not)\s+be\s+returned)|excluded|except|no\s+(?:returns?|refunds?|exchanges?)|(?:returns?|refunds?|exchanges?)\s+(?:(?:are\s+)?(?:(?:not|never)\s+(?:accepted|allowed|available|offered|permitted|honored|processed)|prohibited)|(?:are|is|was|were)n['’]?t\s+(?:accepted|allowed|available|offered|permitted|honored|processed)|(?:(?:can(?:not|['’]t)|(?:could|would|might)n['’]?t|(?:will|may|might|must|shall|should|could|would)\s+(?:not|never)|(?:may|must|shall|should)n['’]?t|won['’]?t)\s+be\s+(?:accepted|allowed|available|offered|permitted|honored|processed)))|(?:(?:do|does|did)\s+(?:not|never)|(?:do|does|did)n['’]?t|can(?:not|['’]t)|(?:could|would|might)n['’]?t|(?:will|may|might|must|shall|should|could|would)\s+(?:not|never)|(?:may|must|shall|should)n['’]?t|won['’]?t)\s+accept\s+(?:returns?|refunds?|exchanges?)|(?:(?:has|have|had)\s+(?:not|never)|(?:has|have|had)n['’]?t)\s+accepted\s+(?:returns?|refunds?|exchanges?)|(?:(?:is|are|was|were)\s+(?:not|never)|(?:is|are|was|were)n['’]?t)\s+accepting\s+(?:returns?|refunds?|exchanges?))\b/i;
const POLICY_DENIAL_SIGNAL_PATTERN =
	/\b(?:(?:returns?|refunds?|exchanges?)\s+(?:(?:(?:are|is|was|were)\s+)?(?:unavailable|prohibited|denied|refused|excluded)|(?:are|is|was|were)\s+(?:not|never)\s+(?:accepted|allowed|available|offered|permitted|honored|processed)|(?:have|has|had)\s+been\s+(?:prohibited|denied|refused|excluded)|(?:have|has|had)\s+(?:not|never)\s+been\s+(?:accepted|allowed|available|offered|permitted|honored|processed)|(?:are|is|was|were)\s+being\s+(?:prohibited|denied|refused|excluded))|(?:we|store|merchant)\s+(?:deny|denies|denied|refuse|refuses|refused)\s+(?:returns?|refunds?|exchanges?)|(?:(?:has|have|had)\s+(?:not|never)\s+been|(?:has|have|had)n['’]?t\s+been)\s+accepting\s+(?:returns?|refunds?|exchanges?)|(?:(?:is|are|was|were)\s+|(?:has|have|had)\s+been\s+)(?:refusing|denying)\s+(?:returns?|refunds?|exchanges?)|(?:has|have|had)\s+(?:refused|denied)\s+(?:returns?|refunds?|exchanges?)|(?:will|would|may|might|must|shall|should|can|could)\s+(?:refuse|deny)\s+(?:returns?|refunds?|exchanges?))\b/i;
const WARRANTY_EXCLUSION_PATTERN =
	/\b(?:not|never)\s+(?:covered|included)\s+(?:by|under)\s+(?:the\s+)?warrant(?:y|ies)\b|\bexcluded\s+from\s+(?:the\s+)?warrant(?:y|ies)(?:\s+coverage)?\b|\bwarrant(?:y|ies)(?:\s+coverage)?\s+(?:does\s+not|doesn['’]?t|do\s+not|don['’]?t)\s+(?:cover|include)\b|\bwarrant(?:y|ies)(?:\s+coverage)?\s+exclud(?:e|es|ed)\b|\bwarrant(?:y|ies)(?:\s+(?:is|are|was|were))?\s+void(?:ed)?\b/i;
const PRICE_PATTERN = /(?:[$£€]\s*)?(\d{1,6}(?:[.,]\d{2}))\s*$/;
const NON_ITEM_NAME_PATTERN = /\b(?:purchase\s+date|date|store|cashier)\b/i;
const NON_MERCHANDISE_ITEM_NAME_PATTERN =
	/^\s*(?:(?:\d+(?:[.,]\d+)?%\s+)?(?:discount|coupon(?:\s+(?:discount|savings?))?|promo(?:tion)?|savings?)(?:\s+\d+(?:[.,]\d+)?%)?|shipping(?:\s+(?:and|&)\s+handling)?|delivery|handling|(?:[A-Za-z][A-Za-z &/\-]{0,30}\s+)?(?:fees?|charge|surcharge)|tip|gratuity|deposit|tender|gift\s+card(?:\s+payment)?)[\s:\-–—]*$/i;
const POLICY_REMEDY_QUALIFIER_PATTERN =
	/^(?:(?:a|an|the)\s+)?(?:(?:full|partial|cash)\s+)?(?:refund(?:\s+to\s+(?:the\s+)?original\s+(?:(?:form|method)\s+of\s+payment|payment\s+method))?|(?:store|merchandise)\s+credit|(?:store\s+)?gift\s+card|exchange|replacement(?:\s+item)?|refund\s*\/\s*exchange)(?:\s+or\s+(?:(?:a|an|the)\s+)?(?:(?:full|partial|cash)\s+)?(?:refund|(?:store|merchandise)\s+credit|(?:store\s+)?gift\s+card|exchange|replacement(?:\s+item)?))?$/i;
const NON_MERCHANT_PATTERN =
	/\b(?:purchase|transaction|sale)\s+date\b|^\s*date\b|\bcashier\b/i;
const NON_MERCHANT_RECEIPT_LINE_PATTERN =
	/^\s*(?:receipt|invoice|subtotal|total|tax|cash|change|payment|balance|transaction|order|loyalty|member)(?:\s*[:#\-]|\s*$)/i;
const GENERIC_RECEIPT_HEADER_PATTERN =
	/^\s*(?:(?:thank\s+you|thanks)(?:\s+for\s+(?:shopping|your\s+purchase)(?:\s+(?:with|at)\s+us)?)?|welcome(?:\s+back|\s+to\s+(?:(?:our|the)\s+)?store)?|(?:customer|merchant|store|guest)\s+(?:copy|receipt)|your\s+receipt|sales?\s+receipt|original|duplicate)\s*[!.#\-–—]*\s*$/i;
const POLICY_STATEMENT_CONTEXT_PATTERN =
	/\b(?:within|until|through|accepted|allowed|available|offered|eligible|policy|window|deadline|days?|weeks?|months?|years?|submitted|expires?|final\s+sale|all\s+sales|no\s+(?:returns?|refunds?|exchanges?)|may\s+be\s+returned)\b/i;
const POLICY_BODY_CONTEXT_PATTERN =
	/\b(?:within|until|through|before|after|from|following|accepted|allowed|available|offered|expires?|submitted|covered|not\s+covered)\b|\bfor\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b/i;
const POLICY_DEADLINE_DURATION_CONTEXT_PATTERN =
	/\b(?:within|until|through|before|after|from|following|deadline|window|expires?|eligible|available|offered|submitted|covered)\b|\bfor\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b|\b\d{1,4}[-‐‑‒–—](?:day|week|month|year)\s+(?:returns?|refunds?|exchanges?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))\b/i;
const DECLARATIVE_POLICY_DURATION_PATTERN =
	/\b(?:returns?|refunds?|exchanges?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))\s+(?:policy|period|window|coverage|term)(?:\s+is)?\s*[:\-–—]?\s*\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b/i;
const OPERATIONAL_POLICY_TIMING_PATTERN =
	/\b(?:refunds?|rebates?|claims?|repairs?|service|replacement|payments?|payouts?|credits?)\b.{0,80}\b(?:process(?:ed|ing)?|issu(?:e|ed|ing)|paid|credit(?:ed|ing)?|post(?:ed|ing)?|deposit(?:ed|ing)?|settle(?:d|ment|ing)?|complete(?:d|ion)?|review(?:ed|ing)?|repair(?:ed|ing)?|ship(?:ped|ping)?|deliver(?:ed|y|ing)?|take(?:s|n)?|turnaround)\b|\b(?:process(?:ing)?|repair|service|turnaround)\b.{0,60}\b(?:in|within|for)\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b/i;
const POLICY_START_THRESHOLD_PATTERN =
	/\b(?:returns?|refunds?|exchanges?|rebates?|claims?|warrant(?:y|ies)|price\s*(?:match|adjustment))\b.{0,60}\b(?:available|eligible|accepted|allowed|offered|start(?:s|ed|ing)?|begin(?:s|ning)?)\b.{0,30}\b(?:after|from)\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b|\b(?:returns?|refunds?|exchanges?|rebates?|claims?|warrant(?:y|ies)|price\s*(?:match|adjustment))\b.{0,60}\b(?:available|eligible|accepted|allowed|offered|start(?:s|ed|ing)?|begin(?:s|ning)?)\b\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\s+(?:after|from|following)\b/i;
const BARE_POLICY_HEADER_PATTERN =
	/^\s*(?:(?:return(?:s)?|refunds?|exchanges?)(?:\s*(?:&|and|\/)\s*(?:return(?:s)?|refunds?|exchanges?))*|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))(?:\s+(?:policy|eligibility|program|terms?))?\s*[:\-–—]?\s*$/i;
const QUALIFIED_POLICY_HEADER_PATTERN =
	/^\s*(?:return(?:s)?|refunds?|exchanges?)(?:\s*(?:&|and|\/)\s*(?:return(?:s)?|refunds?|exchanges?))*(?:\s+(?:policy|eligibility))?\s*[:\-–—]\s*\S.+$/i;
const PREPOSITION_QUALIFIED_POLICY_HEADER_PATTERN =
	/^\s*(?:return(?:s)?|refunds?|exchanges?)(?:\s+(?:policy|eligibility))?\s+(?:for|on)\s+[A-Za-z][A-Za-z ,&/\-]{1,50}\s*[.!]?$/i;
const TRANSACTION_DATE_LABEL =
	/\b(?:purchase|transaction|sale|receipt)\s+date\b|\bdate\s+of\s+(?:purchase|transaction|sale)\b|^\s*(?:date|kaufdatum)(?=\s*[:\-]?\s*(?:\d|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?))/i;
const BARE_TRANSACTION_DATE_LABEL =
	/^\s*(?:(?:purchase|transaction|sale|receipt)\s+date|date\s+of\s+(?:purchase|transaction|sale)|kaufdatum)\s*[:\-–—]?\s*$/i;

interface ParseOptions {
	locale?: string;
	sourceFingerprint: string;
	sourceKind: "image" | "pdf" | "fixture";
	pageCount?: number;
	now?: () => number;
}

function clampConfidence(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function hasPolicyKeyword(text: string): boolean {
	return POLICY_KEYWORDS.test(text) || HOLIDAY_POLICY_PATTERN.test(text);
}

function looksLikePolicyStatement(text: string): boolean {
	return (
		BARE_POLICY_HEADER_PATTERN.test(text) ||
		QUALIFIED_POLICY_HEADER_PATTERN.test(text) ||
		PREPOSITION_QUALIFIED_POLICY_HEADER_PATTERN.test(text) ||
		(hasPolicyKeyword(text) && POLICY_STATEMENT_CONTEXT_PATTERN.test(text))
	);
}

export function confidenceLabel(value: number): ReceiptConfidence {
	if (value >= 0.86) return "high";
	if (value >= 0.7) return "medium";
	return "low";
}

function evidenceFor(
	lines: OcrLine[],
	line: number,
	start = 0,
	end = lines[line]?.text.length ?? 0,
): EvidenceSpan {
	const source = lines[line];
	return {
		line,
		page: source.page,
		start,
		end,
		text: redactSensitiveText(source.text.slice(start, end)),
		confidence: clampConfidence(source.confidence),
	};
}

function issue(
	code: ExtractionIssue["code"],
	field: string,
	message: string,
	evidence: EvidenceSpan[] = [],
): ExtractionIssue {
	return { code, field, message, evidence };
}

function field<T>(
	value: T | null,
	confidence: number,
	evidence: EvidenceSpan[],
	issues: ExtractionIssue[] = [],
): ExtractedField<T> {
	const normalized = clampConfidence(confidence);
	return {
		value,
		confidence: normalized,
		confidenceLabel: confidenceLabel(normalized),
		evidence,
		issues,
	};
}

function lineConfidenceIssue(
	fieldName: string,
	evidence: EvidenceSpan[],
): ExtractionIssue[] {
	return evidence.some((span) => span.confidence < LOW_OCR_THRESHOLD)
		? [
				issue(
					"ocr_low_confidence",
					fieldName,
					"The supporting text was not recognized confidently enough to trust without correction.",
					evidence,
				),
			]
		: [];
}

function extractMerchant(lines: OcrLine[]): ExtractedField<string> {
	const candidateIndex = lines.findIndex((line, index) => {
		const text = line.text.trim();
		return (
			index < 5 &&
			text.length >= 2 &&
			/[A-Za-z]/.test(text) &&
			!looksLikePolicyStatement(text) &&
			!NON_MERCHANT_RECEIPT_LINE_PATTERN.test(text) &&
			!GENERIC_RECEIPT_HEADER_PATTERN.test(text) &&
			!NON_MERCHANT_PATTERN.test(text) &&
			!PRICE_PATTERN.test(text) &&
			!/^\d/.test(text)
		);
	});
	if (candidateIndex === -1) {
		const missing = issue(
			"missing",
			"merchant",
			"No merchant name could be grounded in the selected document.",
		);
		return field<string>(null, 0, [], [missing]);
	}
	const evidence = [evidenceFor(lines, candidateIndex)];
	const issues = lineConfidenceIssue("merchant", evidence);
	return field(
		lines[candidateIndex].text.trim(),
		Math.min(lines[candidateIndex].confidence, issues.length ? 0.59 : 0.94),
		evidence,
		issues,
	);
}

const DATE_MATCH =
	/\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi;

const DAY_FIRST_MONTH_NAME_DATE_MATCH =
	/\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/gi;

function parseDateCandidate(
	value: string,
	locale?: string,
): { date: string | null; ambiguous: boolean } {
	const normalizedLocale = locale?.toLowerCase();
	const formats: string[] = [];
	if (/^\d{4}-/.test(value)) formats.push("yyyy-M-d");
	else if (/^[A-Za-z]/.test(value)) formats.push("MMMM d yyyy", "MMM d yyyy");
	else if (/^\d{1,2}\s+[A-Za-z]/.test(value))
		formats.push("d MMMM yyyy", "d MMM yyyy");
	else {
		const parts = value.split(/[/.\-]/).map(Number);
		const [first, second] = parts;
		// A two-digit year has no safe century binding. Never silently turn an
		// older receipt into a deadline many decades in the future.
		if (parts[2] < 100) return { date: null, ambiguous: true };
		const year = parts[2];
		const numericOrderIsAmbiguous = first <= 12 && second <= 12 && first !== second;
		const knownMonthFirst = normalizedLocale === "en-us";
		const knownDayFirst =
			/^en-(gb|au|nz)$/.test(normalizedLocale ?? "") ||
			/^(de|fr|es|it|pt|nl)(-|$)/.test(normalizedLocale ?? "");
		if (numericOrderIsAmbiguous && !knownMonthFirst && !knownDayFirst) {
			return { date: null, ambiguous: true };
		}
		const monthFirst =
			knownMonthFirst || (second > 12 && first <= 12);
		formats.push(monthFirst ? "M/d/yyyy" : "d/M/yyyy");
		value = `${first}/${second}/${year}`;
	}
	for (const dateFormat of formats) {
		const cleaned = value.replace(",", "");
		const parsed = parse(cleaned, dateFormat, new Date(2000, 0, 1));
		if (isValid(parsed)) return { date: format(parsed, "yyyy-MM-dd"), ambiguous: false };
	}
	return { date: null, ambiguous: false };
}

function extractTransactionDate(
	lines: OcrLine[],
	locale?: string,
): ExtractedField<string> {
	const matches: Array<{
		date: string;
		evidence: EvidenceSpan;
		isTransactionLabeled: boolean;
	}> = [];
	const ambiguousMatches: Array<{
		evidence: EvidenceSpan;
		isTransactionLabeled: boolean;
	}> = [];
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		DATE_MATCH.lastIndex = 0;
		DAY_FIRST_MONTH_NAME_DATE_MATCH.lastIndex = 0;
		let dateMatches = [
			...line.text.matchAll(DATE_MATCH),
			...line.text.matchAll(DAY_FIRST_MONTH_NAME_DATE_MATCH),
		].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
		const transactionLabel = TRANSACTION_DATE_LABEL.exec(line.text);
		const previousLine = lines[lineIndex - 1];
		const inheritsAdjacentTransactionLabel =
			!transactionLabel &&
			dateMatches.length === 1 &&
			line.text.replace(dateMatches[0][0], "").trim().length === 0 &&
			previousLine?.page === line.page &&
			BARE_TRANSACTION_DATE_LABEL.test(previousLine.text);
		// Policy dates are interpretation evidence, not receipt facts. A
		// co-located, explicitly labelled purchase date remains a receipt fact.
		if (policyType(line.text) !== null) {
			dateMatches = transactionLabel
				? dateMatches
						.filter((match) => (match.index ?? 0) > transactionLabel.index)
						.slice(0, 1)
				: [];
		}
		const labeledMatchIndex = transactionLabel
			? dateMatches.findIndex(
					(match) => (match.index ?? 0) > transactionLabel.index,
				)
			: inheritsAdjacentTransactionLabel
				? 0
				: -1;
		for (const [dateMatchIndex, match] of dateMatches.entries()) {
			const parsed = parseDateCandidate(match[0], locale);
			const evidence = evidenceFor(
				lines,
				lineIndex,
				match.index ?? 0,
				(match.index ?? 0) + match[0].length,
			);
			const isTransactionLabeled = dateMatchIndex === labeledMatchIndex;
			if (parsed.ambiguous) {
				ambiguousMatches.push({ evidence, isTransactionLabeled });
			} else if (parsed.date) {
				matches.push({ date: parsed.date, evidence, isTransactionLabeled });
			}
		}
	}
	const labeledMatches = matches.filter((match) => match.isTransactionLabeled);
	const ambiguityBlocksSelection =
		ambiguousMatches.some((match) => match.isTransactionLabeled) ||
		(ambiguousMatches.length > 0 && labeledMatches.length === 0);
	if (ambiguityBlocksSelection) {
		const ambiguousEvidence = ambiguousMatches.map((match) => match.evidence);
		const ambiguous = issue(
			"locale_ambiguous",
			"transactionDate",
			"The numeric date needs an unambiguous order and a four-digit year.",
			ambiguousEvidence,
		);
		const issues = [ambiguous];
		if (matches.length > 0) {
			issues.push(
				issue(
					"conflicting",
					"transactionDate",
					"An ambiguous transaction date conflicts with another date in the document.",
					[...ambiguousEvidence, ...matches.map((match) => match.evidence)],
				),
			);
		}
		return field<string>(null, 0, ambiguousEvidence, issues);
	}
	if (labeledMatches.length === 0 && matches.length > 0) {
		const unlabeledEvidence = matches.map((match) => match.evidence);
		return field<string>(null, 0, unlabeledEvidence, [
			issue(
				"missing",
				"transactionDate",
				"A date was found, but the document did not identify it as the transaction date.",
				unlabeledEvidence,
			),
		]);
	}
	const selectableMatches = labeledMatches;
	const distinct = [...new Set(selectableMatches.map((match) => match.date))];
	if (distinct.length === 0) {
		return field<string>(null, 0, [], [
			issue(
				"missing",
				"transactionDate",
				"No transaction date could be grounded in the selected document.",
			),
		]);
	}
	if (distinct.length > 1) {
		return field<string>(null, 0.35, selectableMatches.map((match) => match.evidence), [
			issue(
				"conflicting",
				"transactionDate",
				"More than one plausible transaction date was found.",
				selectableMatches.map((match) => match.evidence),
			),
		]);
	}
	const chosen = selectableMatches.find((match) => match.date === distinct[0]);
	const evidence = chosen ? [chosen.evidence] : [];
	const issues = lineConfidenceIssue("transactionDate", evidence);
	return field(distinct[0], Math.min(evidence[0]?.confidence ?? 0, 0.96), evidence, issues);
}

function plausibleItemName(text: string): boolean {
	DATE_MATCH.lastIndex = 0;
	DAY_FIRST_MONTH_NAME_DATE_MATCH.lastIndex = 0;
	const containsDate =
		DATE_MATCH.test(text) || DAY_FIRST_MONTH_NAME_DATE_MATCH.test(text);
	return (
		text.length >= 2 &&
		/[A-Za-z]/.test(text) &&
		!PRICE_PATTERN.test(text) &&
		!NON_ITEM_PATTERN.test(text) &&
		!NON_ITEM_NAME_PATTERN.test(text) &&
		!NON_MERCHANDISE_ITEM_NAME_PATTERN.test(text) &&
		!hasPolicyKeyword(text) &&
		!containsDate
	);
}

function standalonePrice(text: string): RegExpMatchArray | null {
	const match = text.match(PRICE_PATTERN);
	if (!match) return null;
	return text.slice(0, match.index).trim().length === 0 ? match : null;
}

function nameIndexForStandalonePrice(
	lines: OcrLine[],
	priceIndex: number,
	merchantLineIndex: number | null,
): number | null {
	const pricePage = lines[priceIndex].page;
	let priceBlockStart = priceIndex;
	while (
		priceBlockStart > 0 &&
		lines[priceBlockStart - 1].page === pricePage &&
		standalonePrice(lines[priceBlockStart - 1].text.trim()) !== null
	) {
		priceBlockStart--;
	}
	let priceBlockEnd = priceIndex;
	while (
		priceBlockEnd + 1 < lines.length &&
		lines[priceBlockEnd + 1].page === pricePage &&
		standalonePrice(lines[priceBlockEnd + 1].text.trim()) !== null
	) {
		priceBlockEnd++;
	}

	const nameIndexes: number[] = [];
	for (let index = priceBlockStart - 1; index >= 0; index--) {
		if (lines[index].page !== pricePage) break;
		if (index === merchantLineIndex) break;
		if (!plausibleItemName(lines[index].text.trim())) break;
		nameIndexes.unshift(index);
	}
	const priceCount = priceBlockEnd - priceBlockStart + 1;
	const alignedNameIndexes = nameIndexes.slice(-priceCount);
	return alignedNameIndexes[priceIndex - priceBlockStart] ?? null;
}

function extractItems(
	lines: OcrLine[],
	merchantLineIndex: number | null,
): ReceiptItemFact[] {
	const items: ReceiptItemFact[] = [];
	for (let index = 0; index < lines.length; index++) {
		const text = lines[index].text.trim();
		const priceMatch = text.match(PRICE_PATTERN);
		if (!priceMatch || NON_ITEM_PATTERN.test(text) || hasPolicyKeyword(text)) continue;
		const inlineName = text
			.slice(0, priceMatch.index)
			.replace(/^\d+\s*[xX]\s*/, "")
			.trim();
		const standaloneNameIndex =
			standalonePrice(text) !== null
				? nameIndexForStandalonePrice(lines, index, merchantLineIndex)
				: null;
		const usesStandaloneLine = !plausibleItemName(inlineName) && standaloneNameIndex !== null;
		const name = usesStandaloneLine ? lines[standaloneNameIndex].text.trim() : inlineName;
		if (!plausibleItemName(name)) continue;
		const nameEvidence = evidenceFor(lines, usesStandaloneLine ? standaloneNameIndex : index);
		const priceEvidence = evidenceFor(lines, index);
		const combinedEvidence = usesStandaloneLine
			? [nameEvidence, priceEvidence]
			: [priceEvidence];
		const issues = lineConfidenceIssue(`items.${items.length}`, combinedEvidence);
		const confidence = Math.min(
			...combinedEvidence.map((span) => span.confidence),
			issues.length ? 0.59 : 0.93,
		);
		items.push({
			name: field(name, confidence, [nameEvidence], issues),
			priceDollars: field(
				priceMatch[1].replace(",", "."),
				confidence,
				[priceEvidence],
				issues,
			),
		});
	}
	return items;
}

function standalonePricePairingIssues(
	lines: OcrLine[],
	merchantLineIndex: number | null,
): ExtractionIssue[] {
	return lines.flatMap((line, index) => {
		if (
			standalonePrice(line.text.trim()) === null ||
			nameIndexForStandalonePrice(lines, index, merchantLineIndex) !== null
		) {
			return [];
		}
		return [
			issue(
				"missing",
				"items",
				"A standalone price could not be paired with a purchased item name.",
				[evidenceFor(lines, index)],
			),
		];
	});
}

function policyType(text: string): DeadlineType | null {
	if (OPERATIVE_RETURN_DEADLINE_PATTERN.test(text)) return "return";
	if (/\brebates?\b/i.test(text)) return "rebate";
	if (/\bwarrant(?:y|ies)\b/i.test(text)) return "warranty";
	if (/\bprice\s*(?:match|adjustment)\b/i.test(text)) return "price_adjustment";
	if (RETURN_POLICY_KEYWORDS.test(text) || HOLIDAY_POLICY_PATTERN.test(text))
		return "return";
	return null;
}

function isPolicyExclusion(text: string): boolean {
	const type = policyType(text);
	return (
		POLICY_EXCLUSION_PATTERN.test(text) ||
		(type === "return" && POLICY_DENIAL_SIGNAL_PATTERN.test(text)) ||
		(type === "warranty" && WARRANTY_EXCLUSION_PATTERN.test(text))
	);
}

function isGenericPolicyQualifier(qualifier: string): boolean {
	return (
		/^(?:all(?:\s+other)?|general|standard|handwritten|note|annotation)$/.test(
			qualifier,
		) ||
		/^(?:limited|extended|manufacturer(?:'s)?|mail[\s-]?in|instant|promotional|store)$/.test(
			qualifier,
		) ||
		/^(?:submit|submission|claim|claims|coverage)$/.test(qualifier) ||
		/^(?:(?:all|any)\s+)?(?:items?|purchases?|products?|merchandise)(?:(?:\s+in\s+(?:their\s+)?original\s+condition|\s+with\s+(?:an?\s+)?receipt))*(?:\s+(?:may|can|must|should)\s+be)?$/.test(
			qualifier,
		)
	);
}

function qualifierRequiresItemMatch(rawQualifier: string): boolean {
	const qualifier = rawQualifier
		.trim()
		.replace(/[:\-–—]+$/, "")
		.trim()
		.toLowerCase();
	return (
		qualifier.length > 0 &&
		!hasPolicyKeyword(qualifier) &&
		!POLICY_STATEMENT_CONTEXT_PATTERN.test(qualifier) &&
		!/[\d$£€]/.test(qualifier) &&
		!/\b(?:purchase|transaction|sale|receipt)\s+date\b/.test(qualifier) &&
		!POLICY_REMEDY_QUALIFIER_PATTERN.test(qualifier) &&
		!isGenericPolicyQualifier(qualifier) &&
		!/^(?:all|all items|all purchases|all other items|all other purchases|any item|any items|any purchase|any purchases)$/.test(
			qualifier,
		)
	);
}

function policyRequiresItemQualification(
	text: string,
	type: DeadlineType,
): boolean {
	const qualifiedHeaderMatch =
		/^\s*(?:return(?:s)?|refunds?|exchanges?)(?:\s*(?:&|and|\/)\s*(?:return(?:s)?|refunds?|exchanges?))*(?:\s+(?:policy|eligibility))?\s*[:\-–—]\s*(.+)$/i.exec(
			text,
		);
	if (qualifiedHeaderMatch) {
		if (qualifierRequiresItemMatch(qualifiedHeaderMatch[1])) {
			return true;
		}
	}
	const policyText = text.replace(
		/^\s*(?:returns?|refunds?|exchanges?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))(?:\s+(?:policy|eligibility|program|terms?))?\s*[:\-–—]\s*/i,
		"",
	);
	const leadingMatch = (
		{
			return:
				/^\s*(.*?)\b(?:return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?)\b/i,
			rebate: /^\s*(.*?)\brebates?\b/i,
			warranty: /^\s*(.*?)\bwarrant(?:y|ies)\b/i,
			price_adjustment: /^\s*(.*?)\bprice\s*(?:match|adjustment)\b/i,
		} satisfies Record<DeadlineType, RegExp>
	)[type].exec(policyText);
	if (leadingMatch) {
		if (qualifierRequiresItemMatch(leadingMatch[1])) {
			return true;
		}
	}
	const bodyQualifierMatch =
		/^\s*(.*?)\s+\b(?:(?:may|can|must|should)\s+be\s+(?:returned|refunded|exchanged|submitted|covered)|(?:is|are)\s+(?:eligible|covered)|within|until|through|before|after|from|following|available|offered|expires?|submitted|for(?=\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b))\b/i.exec(
			policyText,
		);
	if (
		bodyQualifierMatch &&
		qualifierRequiresItemMatch(bodyQualifierMatch[1])
	) {
		return true;
	}
	const trailingMatch =
		/\b(?:for|on)\s+([A-Za-z][A-Za-z ,&/\-]{1,50})\s*[.!]?$/i.exec(policyText);
	if (!trailingMatch) return false;
	const qualifier = trailingMatch[1].trim().toLowerCase();
	if (
		POLICY_REMEDY_QUALIFIER_PATTERN.test(qualifier) ||
		/^(?:credit|refund)\s+to\s+the\s+original\s+(?:(?:form|method)\s+of\s+payment|payment\s+method)$|^(?:the\s+)?original\s+(?:(?:form|method)\s+of\s+payment|payment\s+method)$/.test(qualifier)
	) {
		return false;
	}
	return !/^(?:all|all items|all purchases|all other items|all other purchases|any item|any items|any purchase|any purchases)$/.test(
		qualifier,
	);
}

function splitPolicyClauses(text: string): Array<{ text: string; start: number }> {
	const parts = text
		.split(
			/\s*(?:;|\||[.,](?=\s+(?:return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment)))|\band\b(?=\s+(?:return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))))\s*/i,
		)
		.map((part) => part.trim())
		.filter(Boolean);
	let searchFrom = 0;
	return parts.map((part) => {
		const start = Math.max(0, text.indexOf(part, searchFrom));
		searchFrom = start + part.length;
		return { text: part, start };
	});
}

function policyWindowAnchor(
	text: string,
): PolicyInterpretation["windowAnchor"] {
	if (
		/\b(?:from|after|following)\s+(?:the\s+)?(?:(?:later|earlier)\s+of\s+)?(?:purchase|transaction|sale)(?:\s+date)?\s+(?:or|and)\s+(?:the\s+)?(?:delivery|arrival)(?:\s+date)?\b/i.test(
			text,
		) ||
		/\b(?:from|after|following)\s+(?:the\s+)?(?:(?:later|earlier)\s+of\s+)?(?:delivery|arrival)(?:\s+date)?\s+(?:or|and)\s+(?:the\s+)?(?:purchase|transaction|sale)(?:\s+date)?\b/i.test(
			text,
		) ||
		/\b(?:of|after|from|following|upon)\s+(?:the\s+)?(?:date\s+of\s+)?(?:deliver(?:y|ed)|arriv(?:al|ed))\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:item|product|order|goods)\s+(?:is|was|are|were)\s+delivered\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:item|product|order|goods|package|shipment)\s+(?:(?:arriv(?:e|es|ed))|(?:(?:has|have|had)\s+arrived))\b/i.test(
			text,
		)
	) {
		return "delivery_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?(?:ship(?:ment|ped|ping)|dispatch(?:ed|ing)?)\b/i.test(
			text,
		)
	) {
		return "shipment_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?install(?:ation|ed)\b/i.test(
			text,
		)
	) {
		return "installation_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?manufactur(?:e|ed|ing)\b/i.test(
			text,
		) ||
		/\b(?:of|after|from|following)\s+(?:the\s+)?production\s+date\b/i.test(text) ||
		/\bafter\s+(?:the\s+)?(?:product|item|device|goods)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+manufactured\b/i.test(
			text,
		)
	) {
		return "manufacture_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?activat(?:ion|ed)\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:product|item|device|goods)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+activated\b/i.test(
			text,
		) ||
		/\b(?:of|after|from|following)\s+(?:the\s+)?first\s+use\b/i.test(text)
	) {
		return "activation_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?registrat(?:ion|ed)\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:product|item|device|goods)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+registered\b/i.test(
			text,
		)
	) {
		return "registration_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?receipt\b/i.test(
			text,
		) ||
		/\b(?:of|after|from|following|upon)\s+(?:the\s+)?(?:date\s+of\s+)?(?:pick[ -]?up|collection|collected)\b/i.test(
			text,
		) ||
		/\b(?:of|after|from|following)\s+receiv(?:e|ed|ing)\b/i.test(text) ||
		/\bafter\s+(?:the\s+)?(?:item|product|order|goods|package|shipment)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+received\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:item|product|order|goods|package|shipment)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+(?:picked\s+up|collected)\b/i.test(
			text,
		)
	) {
		return "receipt_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?replacement\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:item|product|order|goods|device)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+replaced\b/i.test(
			text,
		)
	) {
		return "replacement_date";
	}
	if (
		/\b(?:of|after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?exchange\b/i.test(
			text,
		) ||
		/\bafter\s+(?:the\s+)?(?:item|product|order|goods|device)\s+(?:(?:is|was|are|were)|(?:has|have|had)\s+been)\s+exchanged\b/i.test(
			text,
		)
	) {
		return "exchange_date";
	}
	if (
		/\b(?:from|after|following)\s+(?:the\s+)?(?:expir(?:ation|y)|termination|cessation|end(?:ing)?|lapse)\s+of\s+(?:the\s+)?(?:(?:manufacturer(?:['’]s)?|original|standard|prior|existing)\s+)?warrant(?:y|ies)\b/i.test(
			text,
		) ||
		/\b(?:from|after|following)\s+(?:the\s+)?(?:(?:manufacturer(?:['’]s)?|original|standard|prior|existing)\s+)?warrant(?:y|ies)\s+(?:expir(?:ation|y)|termination|cessation|end(?:ing)?|lapse)\b/i.test(
			text,
		) ||
		/\b(?:from|after|following)\s+(?:the\s+)?(?:(?:manufacturer(?:['’]s)?|original|standard|prior|existing)\s+)?warrant(?:y|ies)\s+(?:(?:has|have|had)\s+)?(?:expir(?:e|es|ed|ing)|end(?:s|ed|ing)?|terminat(?:e|es|ed|ing)|laps(?:e|es|ed|ing)|ceas(?:e|es|ed|ing))\b/i.test(
			text,
		)
	) {
		return "prior_policy_expiration_date";
	}
	return "transaction_date";
}

function parsePolicyDates(
	text: string,
	locale?: string,
): {
	dates: string[];
	ambiguousRanges: Array<{ start: number; end: number }>;
	unparsedRanges: Array<{ start: number; end: number }>;
} {
	const explicitDateCues = [
		...text.matchAll(
			/\b(?:by\s+no\s+later\s+than|on\s+or\s+before|no\s+later\s+than|not\s+after|prior\s+to|by(?!\s+(?:mail|e-?mail|post|courier)\b)|until|through|before|due(?:\s+on)?|deadline(?:\s+is)?|expires?(?:\s+on)?|valid\s+(?:to|until))\b/gi,
		),
	];
	if (explicitDateCues.length === 0) {
		return { dates: [], ambiguousRanges: [], unparsedRanges: [] };
	}
	const dates: string[] = [];
	const ambiguousRanges: Array<{ start: number; end: number }> = [];
	const recognizedRanges: Array<{ start: number; end: number }> = [];
	DATE_MATCH.lastIndex = 0;
	DAY_FIRST_MONTH_NAME_DATE_MATCH.lastIndex = 0;
	const dateMatches = [
		...text.matchAll(DATE_MATCH),
		...text.matchAll(DAY_FIRST_MONTH_NAME_DATE_MATCH),
	].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
	for (const match of dateMatches) {
		if ((match.index ?? 0) <= (explicitDateCues[0].index ?? 0)) continue;
		const parsed = parseDateCandidate(match[0], locale);
		const range = {
			start: match.index ?? 0,
			end: (match.index ?? 0) + match[0].length,
		};
		if (parsed.date) {
			dates.push(parsed.date);
			recognizedRanges.push(range);
		}
		if (parsed.ambiguous) {
			ambiguousRanges.push(range);
			recognizedRanges.push(range);
		}
	}
	return {
		dates: [...new Set(dates)],
		ambiguousRanges,
		unparsedRanges: explicitDateCues.flatMap((cue, index) => {
			const start = cue.index ?? 0;
			const end = explicitDateCues[index + 1]?.index ?? text.length;
			return recognizedRanges.some((range) => range.start > start && range.start < end)
				? []
				: [{ start, end }];
		}),
	};
}

function extractPolicies(
	lines: OcrLine[],
	locale: string | undefined,
	merchantLineIndex: number | null,
): PolicyInterpretation[] {
	const policies: PolicyInterpretation[] = [];
	let lastPolicyGroup: PolicyInterpretation[] = [];
	let lastPolicyLine = -1;
	let activeBareHeader: {
		type: DeadlineType;
		headerLine: number;
		lastBodyLine: number;
	} | null = null;
	for (let index = 0; index < lines.length; index++) {
		const text = lines[index].text.trim();
		if (index === merchantLineIndex) continue;
		if (BARE_POLICY_HEADER_PATTERN.test(text)) {
			const headerType = policyType(text);
			activeBareHeader = headerType
				? { type: headerType, headerLine: index, lastBodyLine: index }
				: null;
			continue;
		}
		const splitClauses = splitPolicyClauses(text);
		const hasDirectPolicyType = splitClauses.some(
			(clause) => policyType(clause.text) !== null,
		);
		const inheritedHeader: {
			type: DeadlineType;
			headerLine: number;
			lastBodyLine: number;
		} | null =
			activeBareHeader !== null &&
			!hasDirectPolicyType &&
			index === activeBareHeader.lastBodyLine + 1 &&
			lines[activeBareHeader.headerLine]?.page === lines[index].page &&
			(POLICY_BODY_CONTEXT_PATTERN.test(text) ||
				(isPolicyExclusion(text) && activeBareHeader.lastBodyLine !== lastPolicyLine))
				? {
						type: activeBareHeader.type,
						headerLine: activeBareHeader.headerLine,
						lastBodyLine: activeBareHeader.lastBodyLine,
					}
				: null;
		if (inheritedHeader) {
			activeBareHeader = {
				type: inheritedHeader.type,
				headerLine: inheritedHeader.headerLine,
				lastBodyLine: index,
			};
		} else {
			activeBareHeader = null;
		}
		const directTypes = [
			...new Set(
				splitClauses
					.map((clause) => policyType(clause.text) ?? inheritedHeader?.type ?? null)
					.filter((type): type is DeadlineType => type !== null),
			),
		];
		const typedClauses = splitClauses
			.flatMap(
				(
					clause,
				): Array<{ text: string; start: number; type: DeadlineType | null }> => {
				const directType = policyType(clause.text) ?? inheritedHeader?.type ?? null;
				if (directType) {
					return [{ ...clause, type: directType }];
				}
				if (
					directTypes.length > 0 &&
					(isPolicyExclusion(clause.text) ||
						POLICY_BODY_CONTEXT_PATTERN.test(clause.text))
				) {
					// An untyped continuation on a mixed-policy OCR line is ambiguous.
					// Preserve it for every supported type on that line rather than
					// silently dropping an applicable duration or guessing its owner.
					return directTypes.map((type) => ({ ...clause, type }));
				}
				return [{ ...clause, type: null }];
				},
			)
			.filter(
				(clause): clause is { text: string; start: number; type: DeadlineType } =>
					clause.type !== null,
			);
		const canAttachTypedStandaloneExclusion =
			typedClauses.length > 0 &&
			isPolicyExclusion(text) &&
			!/\b\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b/i.test(text) &&
			lastPolicyGroup.length > 0 &&
			index - lastPolicyLine <= 2 &&
			lines[lastPolicyLine]?.page === lines[index].page;
		if (canAttachTypedStandaloneExclusion) {
			const exclusionEvidence = evidenceFor(lines, index);
			const directTypeSet = new Set(directTypes);
			for (const policy of lastPolicyGroup) {
				if (directTypeSet.size > 0 && !directTypeSet.has(policy.type)) continue;
				policy.exclusions.push(redactSensitiveText(text));
				policy.evidence.push(exclusionEvidence);
				policy.issues.push(
					...lineConfidenceIssue(`policy.${policy.type}`, [exclusionEvidence]),
				);
				policy.confidence = Math.min(policy.confidence, exclusionEvidence.confidence);
				policy.confidenceLabel = confidenceLabel(policy.confidence);
			}
			continue;
		}
		if (typedClauses.length === 0) {
			const isNearbyStandaloneExclusion =
				isPolicyExclusion(text) &&
				lastPolicyGroup.length > 0 &&
				index - lastPolicyLine <= 2 &&
				lines[lastPolicyLine]?.page === lines[index].page;
			if (isNearbyStandaloneExclusion) {
				const exclusionEvidence = evidenceFor(lines, index);
				for (const policy of lastPolicyGroup) {
					policy.exclusions.push(redactSensitiveText(text));
					policy.evidence.push(exclusionEvidence);
					policy.issues.push(
						...lineConfidenceIssue(`policy.${policy.type}`, [exclusionEvidence]),
					);
					policy.confidence = Math.min(policy.confidence, exclusionEvidence.confidence);
					policy.confidenceLabel = confidenceLabel(policy.confidence);
				}
			}
			continue;
		}
		const policiesForLine: PolicyInterpretation[] = [];
		for (const clause of typedClauses) {
			const ambiguousDurationRanges = [
				...clause.text.matchAll(
					/\b\d{1,4}(?:[.,]\d+|\s*(?:[-‐‑‒–—/]|to|through|and|or)\s*(?:(?:about|approximately|up\s+to)\s+)?\d{1,4})(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b/gi,
				),
				...clause.text.matchAll(
					/\b\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\s*(?:[-‐‑‒–—/]|to|through|and|or|up\s+to)\s*(?:(?:about|approximately)\s+)?\d{1,4}\b/gi,
				),
				...clause.text.matchAll(
					/\b\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\s+or\s+(?:more|longer|less|fewer)\b/gi,
				),
				...clause.text.matchAll(
					/\b(?:about|approximately|around|roughly)\s+\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)\b/gi,
				),
			].map((match) => ({
				start: match.index ?? 0,
				end: (match.index ?? 0) + match[0].length,
			}));
			const excludesAmbiguousDuration = (match: RegExpMatchArray): boolean => {
				const start = match.index ?? 0;
				const end = start + match[0].length;
				return !ambiguousDurationRanges.some(
					(range) => start < range.end && end > range.start,
				);
			};
			const rawWindowMatches = [
				...clause.text.matchAll(
					/\b(\d{1,4})(?:\s+|[-‐‑‒–—]\s*)days?\b/gi,
				),
			];
			const rawYearMatches = [
				...clause.text.matchAll(
					/\b(\d{1,2})(?:\s+|[-‐‑‒–—]\s*)years?\b/gi,
				),
			];
			const rawMonthMatches = [
				...clause.text.matchAll(
					/\b(\d{1,3})(?:\s+|[-‐‑‒–—]\s*)months?\b/gi,
				),
			];
			const rawWeekMatches = [
				...clause.text.matchAll(
					/\b(\d{1,3})(?:\s+|[-‐‑‒–—]\s*)weeks?\b/gi,
				),
			];
			const hasDuration =
				rawWindowMatches.length > 0 ||
				rawYearMatches.length > 0 ||
				rawMonthMatches.length > 0 ||
				rawWeekMatches.length > 0;
			const hasDeadlineDurationContext =
				(POLICY_DEADLINE_DURATION_CONTEXT_PATTERN.test(clause.text) ||
					DECLARATIVE_POLICY_DURATION_PATTERN.test(clause.text)) &&
				!OPERATIONAL_POLICY_TIMING_PATTERN.test(clause.text) &&
				!POLICY_START_THRESHOLD_PATTERN.test(clause.text);
			const windowMatches = hasDeadlineDurationContext
				? rawWindowMatches.filter(excludesAmbiguousDuration)
				: [];
			const yearMatches = hasDeadlineDurationContext
				? rawYearMatches.filter(excludesAmbiguousDuration)
				: [];
			const monthMatches = hasDeadlineDurationContext
				? rawMonthMatches.filter(excludesAmbiguousDuration)
				: [];
			const weekMatches = hasDeadlineDurationContext
				? rawWeekMatches.filter(excludesAmbiguousDuration)
				: [];
			const parsedPolicyDates = parsePolicyDates(clause.text, locale);
			const windowAnchor = policyWindowAnchor(clause.text);
			const evidence = [
				...(inheritedHeader
					? [evidenceFor(lines, inheritedHeader.headerLine)]
					: []),
				evidenceFor(lines, index, clause.start, clause.start + clause.text.length),
			];
			const issues = lineConfidenceIssue(`policy.${clause.type}`, evidence);
			if (hasDuration && !hasDeadlineDurationContext) {
				issues.push(
					issue(
						"conflicting",
						`policy.${clause.type}.windowDuration`,
						"A processing, service, or eligibility-start duration is not enough evidence of a deadline window.",
						evidence,
					),
				);
			}
			for (const range of ambiguousDurationRanges) {
				const ambiguousEvidence = evidenceFor(
					lines,
					index,
					clause.start + range.start,
					clause.start + range.end,
				);
				issues.push(
					issue(
						"conflicting",
						`policy.${clause.type}.windowDuration`,
						"An approximate, fractional, or ranged policy duration must be resolved without guessing.",
						[ambiguousEvidence],
					),
				);
			}
			if (windowAnchor !== "transaction_date") {
				issues.push(
					issue(
						"missing",
						`policy.${clause.type}.windowAnchor`,
						`The policy window starts from ${windowAnchor.replace("_date", "")}, but that anchor date is not available.`,
						evidence,
					),
				);
			}
			for (const range of parsedPolicyDates.ambiguousRanges) {
				const ambiguousEvidence = evidenceFor(
					lines,
					index,
					clause.start + range.start,
					clause.start + range.end,
				);
				issues.push(
					issue(
						"locale_ambiguous",
						`policy.${clause.type}.explicitDate`,
						"An explicit policy date needs an unambiguous order and a four-digit year.",
						[ambiguousEvidence],
					),
				);
			}
			for (const range of parsedPolicyDates.unparsedRanges) {
				const unresolvedEvidence = evidenceFor(
					lines,
					index,
					clause.start + range.start,
					clause.start + range.end,
				);
				issues.push(
					issue(
						"conflicting",
						`policy.${clause.type}.explicitDate`,
						"The policy contains an explicit date alternative that could not be resolved without guessing.",
						[unresolvedEvidence],
					),
				);
			}
			const exclusions = isPolicyExclusion(clause.text)
				? [redactSensitiveText(clause.text)]
				: [];
			const itemQualificationRequired = policyRequiresItemQualification(
				clause.text,
				clause.type,
			);
			const variants: Array<{
				windowDays: number | null;
				windowUnit: "days" | "months" | "years" | null;
				explicitDate: string | null;
			}> = [
				...windowMatches.map((match) => ({
					windowDays: Number(match[1]),
					windowUnit: "days" as const,
					explicitDate: null,
				})),
				...weekMatches.map((match) => ({
					windowDays: Number(match[1]) * 7,
					windowUnit: "days" as const,
					explicitDate: null,
				})),
				...monthMatches.map((match) => ({
					windowDays: Number(match[1]),
					windowUnit: "months" as const,
					explicitDate: null,
				})),
				...yearMatches.map((match) => ({
					windowDays: Number(match[1]) * 365,
					windowUnit: "years" as const,
					explicitDate: null,
				})),
				...parsedPolicyDates.dates.map((date) => ({
					windowDays: null,
					windowUnit: null,
					explicitDate: date,
				})),
			];
			if (variants.length === 0) {
				variants.push({ windowDays: null, windowUnit: null, explicitDate: null });
			}
			const confidence = clampConfidence(
				Math.min(lines[index].confidence, issues.length ? 0.59 : 0.92),
			);
			policiesForLine.push(
				...variants.map((variant) => ({
					type: clause.type,
					...variant,
					windowAnchor,
					description: redactSensitiveText(clause.text),
					exclusions: [...exclusions],
					itemQualificationRequired,
					confidence,
					confidenceLabel: confidenceLabel(confidence),
					evidence: [...evidence],
					issues: [...issues],
				})),
			);
		}
		if (hasDirectPolicyType) {
			const directTypesForLine = [
				...new Set(
					splitClauses
						.map((clause) => policyType(clause.text))
						.filter((type): type is DeadlineType => type !== null),
				),
			];
			activeBareHeader =
				directTypesForLine.length === 1
					? {
							type: directTypesForLine[0],
							headerLine: index,
							lastBodyLine: index,
						}
					: null;
		}
		lastPolicyGroup = policiesForLine;
		lastPolicyLine = index;
		policies.push(...policiesForLine);
	}
	return policies;
}

export function deriveDeadlineDate(
	policy: PolicyInterpretation,
	transactionDate: string | null,
): string | null {
	if (policy.explicitDate) {
		return transactionDate && policy.explicitDate < transactionDate
			? null
			: policy.explicitDate;
	}
	if (policy.windowAnchor !== "transaction_date") return null;
	if (!transactionDate || policy.windowDays === null) return null;
	const date = parse(transactionDate, "yyyy-MM-dd", new Date(2000, 0, 1));
	if (!isValid(date)) return null;
	if (policy.windowUnit === "years") {
		return format(addYears(date, policy.windowDays / 365), "yyyy-MM-dd");
	}
	if (policy.windowUnit === "months") {
		return format(addMonths(date, policy.windowDays), "yyyy-MM-dd");
	}
	return format(addDays(date, policy.windowDays), "yyyy-MM-dd");
}

export function deriveDeadlineDateForPolicies(
	type: DeadlineType,
	policies: PolicyInterpretation[],
	transactionDate: string | null,
): string | null {
	const matching = policies.filter((policy) => policy.type === type);
	const distinctDates = [
		...new Set(
			matching
				.map((policy) => deriveDeadlineDate(policy, transactionDate))
				.filter((date): date is string => date !== null),
		),
	];
	return distinctDates.length === 1 ? distinctDates[0] : null;
}

function buildCandidates(
	policies: PolicyInterpretation[],
	transactionDate: ExtractedField<string>,
	items: ReceiptItemFact[],
): DeadlineCandidate[] {
	const candidates: DeadlineCandidate[] = [];
	const grouped = new Map<DeadlineType, PolicyInterpretation[]>();
	for (const policy of policies) {
		grouped.set(policy.type, [...(grouped.get(policy.type) ?? []), policy]);
	}
	for (const [type, interpretations] of grouped) {
		const date = deriveDeadlineDateForPolicies(
			type,
			interpretations,
			transactionDate.value,
		);
		const allDates = interpretations
			.map((policy) => deriveDeadlineDate(policy, transactionDate.value))
			.filter((candidate): candidate is string => candidate !== null);
		const distinctDates = [...new Set(allDates)];
		const sharedEvidence = interpretations.flatMap((policy) => policy.evidence);
		const sharedIssues = interpretations.flatMap((policy) => policy.issues);
		const hasImpossibleExplicitChronology =
			transactionDate.value !== null &&
			interpretations.some(
				(policy) =>
					policy.explicitDate !== null &&
					policy.explicitDate < transactionDate.value!,
			);
		if (hasImpossibleExplicitChronology) {
			sharedIssues.push(
				issue(
					"conflicting",
					`candidate.${type}.date`,
					"The explicit deadline predates the transaction date and cannot be used without correction.",
					sharedEvidence,
				),
			);
		}
		if (distinctDates.length > 1) {
			sharedIssues.push(
				issue(
					"multiple_deadlines",
					`candidate.${type}`,
					"The policy text supports more than one deadline; choose the applicable one.",
					sharedEvidence,
				),
				issue(
					"conflicting",
					`candidate.${type}`,
					"Conflicting policy windows prevent an automatic candidate date.",
					sharedEvidence,
				),
			);
		}
		const hasUnverifiedHolidayEligibility = interpretations.some((policy) =>
			/\bholiday\b/i.test(policy.description),
		);
		if (
			hasUnverifiedHolidayEligibility &&
			!sharedIssues.some(
				(entry) =>
					entry.code === "multiple_deadlines" && entry.field === `candidate.${type}`,
			)
		) {
			sharedIssues.push(
				issue(
					"multiple_deadlines",
					`candidate.${type}`,
					"The document does not establish that this purchase qualifies for the holiday extension.",
					sharedEvidence,
				),
			);
		}
		const needsItemPolicyMatch = interpretations.some(
			(policy) =>
				policy.exclusions.length > 0 || policy.itemQualificationRequired,
		);
		if (needsItemPolicyMatch) {
			sharedIssues.push(
				issue(
					"multiple_deadlines",
					`candidate.${type}`,
					"An exclusion or category-specific rule must be matched to the item by the user.",
					sharedEvidence,
				),
			);
		}
		if (!transactionDate.value && interpretations.some((policy) => !policy.explicitDate)) {
			sharedIssues.push(...transactionDate.issues);
		}
		if (!date) {
			sharedIssues.push(
				issue(
					"missing",
					`candidate.${type}.date`,
					"A deadline date could not be derived without guessing.",
					sharedEvidence,
				),
			);
		}
		const rawConfidence = Math.min(
			transactionDate.value ? transactionDate.confidence : 1,
			...interpretations.map((policy) => policy.confidence),
		);
		const blocking = sharedIssues.some((entry) =>
			[
				"missing",
				"conflicting",
				"locale_ambiguous",
				"ocr_low_confidence",
				"multiple_deadlines",
			].includes(entry.code),
		);
		const state: CandidateState = date && !blocking ? "ready_for_confirmation" : "needs_correction";
		// Confidence describes whether this candidate can be trusted as-is. A
		// plausible date with a blocking ambiguity is deliberately calibrated low.
		const confidence = blocking ? Math.min(rawConfidence, 0.35) : rawConfidence;
		const itemName = items.length === 1 ? items[0].name.value : null;
		candidates.push({
			id: `${type}-${candidates.length + 1}`,
			type,
			label: type.replace("_", " "),
			itemName,
			candidateDate: date,
			confidence,
			confidenceLabel: confidenceLabel(confidence),
			state,
			evidence: [...transactionDate.evidence, ...sharedEvidence],
			issues: sharedIssues,
		});
	}
	return candidates;
}

export function extractReceiptCapture(
	lines: OcrLine[],
	options: ParseOptions,
): ReceiptCaptureResult {
	const startedAt = options.now?.() ?? performance.now();
	const merchant = extractMerchant(lines);
	const transactionDate = extractTransactionDate(lines, options.locale);
	const merchantLineIndex = merchant.evidence[0]?.line ?? null;
	const items = extractItems(lines, merchantLineIndex);
	const pricePairingIssues = standalonePricePairingIssues(lines, merchantLineIndex);
	const policies = extractPolicies(lines, options.locale, merchantLineIndex);
	const candidates = buildCandidates(policies, transactionDate, items);
	const issues = [
		...merchant.issues,
		...transactionDate.issues,
		...pricePairingIssues,
		...items.flatMap((item) => [...item.name.issues, ...item.priceDollars.issues]),
		...policies.flatMap((policy) => policy.issues),
		...candidates.flatMap((candidate) => candidate.issues),
	];
	if (items.length === 0) {
		issues.push(issue("missing", "items", "No purchased item candidates were found."));
	}
	if (policies.length === 0) {
		issues.push(
			issue(
				"policy_not_found",
				"policy",
				"No return, rebate, warranty, or price-adjustment policy was found.",
			),
		);
	}
	let overallState: CandidateState;
	const receiptFactsNeedCorrection = issues.some(
		(entry) =>
			(entry.field === "merchant" ||
				entry.field === "transactionDate" ||
				entry.field === "items" ||
				entry.field.startsWith("items.")) &&
			["missing", "conflicting", "locale_ambiguous", "ocr_low_confidence"].includes(
				entry.code,
			),
	);
	if (candidates.length === 0) overallState = "refused";
	else if (
		receiptFactsNeedCorrection ||
		candidates.some((candidate) => candidate.state === "needs_correction")
	) {
		overallState = "needs_correction";
	} else overallState = "ready_for_confirmation";
	const finishedAt = options.now?.() ?? performance.now();
	return {
		schema: "ReceiptCaptureResultV1",
		source: {
			fingerprint: options.sourceFingerprint,
			kind: options.sourceKind,
			pageCount: options.pageCount ?? Math.max(1, ...lines.map((line) => line.page ?? 1)),
			rawContentRetained: false,
		},
		receiptFacts: { merchant, transactionDate, items },
		policyInterpretations: policies,
		candidates,
		issues,
		overallState,
		processingMs: Math.max(0, finishedAt - startedAt),
	};
}
