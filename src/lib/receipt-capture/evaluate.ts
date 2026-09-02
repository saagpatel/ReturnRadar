import { extractReceiptCapture } from "./extract";
import type { CaptureFixture, DeadlineType } from "./types";

export interface CorpusMetrics {
	fixtureCount: number;
	fieldAccuracy: number;
	deadlineAccuracy: number;
	confidenceBrierScore: number;
	refusalPrecision: number;
	refusalRecall: number;
	meanCorrectionFields: number;
	correctionBudgetViolations: number;
	p95LatencyMs: number;
}

function percentile(values: number[], quantile: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

export function evaluateCorpus(fixtures: CaptureFixture[]): CorpusMetrics {
	let correctFields = 0;
	let expectedFields = 0;
	let correctDeadlines = 0;
	let comparedDeadlines = 0;
	let brierSum = 0;
	let brierCount = 0;
	let trueRefusals = 0;
	let actualRefusals = 0;
	let expectedRefusals = 0;
	let correctionFields = 0;
	let correctionBudgetViolations = 0;
	const latencies: number[] = [];

	for (const fixture of fixtures) {
		// Exercise the same locale-neutral path as the document import UI. Fixture
		// locale is descriptive metadata, never evidence supplied to extraction.
		const result = extractReceiptCapture(fixture.lines, {
			sourceFingerprint: `fixture:${fixture.id}`,
			sourceKind: "fixture",
		});
		latencies.push(result.processingMs);
		if (fixture.expect.merchant !== undefined) {
			expectedFields++;
			if (result.receiptFacts.merchant.value === fixture.expect.merchant) correctFields++;
		}
		if (fixture.expect.transactionDate !== undefined) {
			expectedFields++;
			if (result.receiptFacts.transactionDate.value === fixture.expect.transactionDate) {
				correctFields++;
			}
		}
		const expectedItemNames = new Set(fixture.expect.itemNames ?? []);
		const actualItemNames = new Set(
			result.receiptFacts.items
				.map((item) => item.name.value)
				.filter((name): name is string => name !== null),
		);
		const itemUnion = new Set([...expectedItemNames, ...actualItemNames]);
		expectedFields += itemUnion.size;
		correctFields += [...expectedItemNames].filter((name) =>
			actualItemNames.has(name),
		).length;
		const expectedDeadlineKeys = new Set(
			(fixture.expect.candidates ?? []).map(
				(candidate) => `${candidate.type}:${candidate.date}`,
			),
		);
		const actualDeadlineKeys = new Set(
			result.candidates
				.filter((candidate) => candidate.candidateDate !== null)
				.map((candidate) => `${candidate.type}:${candidate.candidateDate}`),
		);
		const deadlineUnion = new Set([
			...expectedDeadlineKeys,
			...actualDeadlineKeys,
		]);
		comparedDeadlines += deadlineUnion.size;
		correctDeadlines += [...expectedDeadlineKeys].filter((key) =>
			actualDeadlineKeys.has(key),
		).length;
		for (const candidate of result.candidates) {
			const expected = fixture.expect.candidates?.some(
				(entry: { type: DeadlineType; date: string }) =>
					entry.type === candidate.type && entry.date === candidate.candidateDate,
			)
				? 1
				: 0;
			brierSum += (candidate.confidence - expected) ** 2;
			brierCount++;
		}
		for (const expectedKey of expectedDeadlineKeys) {
			if (!actualDeadlineKeys.has(expectedKey)) {
				brierSum += 1;
				brierCount++;
			}
		}
		if (result.overallState === "refused") {
			actualRefusals++;
			if (fixture.expect.state === "refused") trueRefusals++;
		}
		if (fixture.expect.state === "refused") expectedRefusals++;
		const fixtureCorrectionFields = new Set(
			result.issues
				.filter((entry) =>
					["missing", "conflicting", "locale_ambiguous", "ocr_low_confidence", "multiple_deadlines"].includes(entry.code),
				)
				.map((entry) => entry.field),
		).size;
		correctionFields += fixtureCorrectionFields;
		if (fixtureCorrectionFields > fixture.expect.maxCorrectionFields) {
			correctionBudgetViolations++;
		}
	}

	return {
		fixtureCount: fixtures.length,
		fieldAccuracy: expectedFields === 0 ? 1 : correctFields / expectedFields,
		deadlineAccuracy:
			comparedDeadlines === 0 ? 1 : correctDeadlines / comparedDeadlines,
		confidenceBrierScore: brierCount === 0 ? 0 : brierSum / brierCount,
		refusalPrecision: actualRefusals === 0 ? 1 : trueRefusals / actualRefusals,
		refusalRecall: expectedRefusals === 0 ? 1 : trueRefusals / expectedRefusals,
		meanCorrectionFields:
			fixtures.length === 0 ? 0 : correctionFields / fixtures.length,
		correctionBudgetViolations,
		p95LatencyMs: percentile(latencies, 0.95),
	};
}
