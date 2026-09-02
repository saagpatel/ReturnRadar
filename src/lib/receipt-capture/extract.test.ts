import { describe, expect, it } from "vitest";
import { RECEIPT_CAPTURE_CORPUS } from "@/test-fixtures/receipt-capture/corpus";
import { evaluateCorpus } from "./evaluate";
import { extractReceiptCapture } from "./extract";

describe("confidence-gated receipt capture corpus", () => {
	for (const fixture of RECEIPT_CAPTURE_CORPUS) {
		it(fixture.id, () => {
			// Match production import: the host and fixture locale are not evidence.
			const result = extractReceiptCapture(fixture.lines, {
				sourceFingerprint: `fixture:${fixture.id}`,
				sourceKind: "fixture",
			});

			expect(result.source.rawContentRetained).toBe(false);
			expect(result.overallState).toBe(fixture.expect.state);
			if (fixture.expect.merchant !== undefined) {
				expect(result.receiptFacts.merchant.value).toBe(fixture.expect.merchant);
			}
			if (fixture.expect.transactionDate !== undefined) {
				expect(result.receiptFacts.transactionDate.value).toBe(
					fixture.expect.transactionDate,
				);
			}
			for (const itemName of fixture.expect.itemNames ?? []) {
				expect(
					result.receiptFacts.items.some((item) => item.name.value === itemName),
				).toBe(true);
			}
			for (const expected of fixture.expect.candidates ?? []) {
				expect(
					result.candidates.some(
						(candidate) =>
							candidate.type === expected.type &&
							candidate.candidateDate === expected.date,
					),
				).toBe(true);
			}
			const issueCodes = new Set(result.issues.map((entry) => entry.code));
			for (const required of fixture.expect.requiredIssues ?? []) {
				expect(issueCodes.has(required)).toBe(true);
			}
			if (fixture.expect.candidateConfidence) {
				expect(result.candidates.length).toBeGreaterThan(0);
				for (const candidate of result.candidates) {
					expect(candidate.confidence).toBeGreaterThanOrEqual(
						fixture.expect.candidateConfidence.min,
					);
					expect(candidate.confidence).toBeLessThanOrEqual(
						fixture.expect.candidateConfidence.max,
					);
				}
			}
			if (result.overallState === "ready_for_confirmation") {
				expect(
					result.candidates.every(
						(candidate) => candidate.state === "ready_for_confirmation",
					),
				).toBe(true);
			}
		});
	}

	it("closes the bounded corpus thresholds", () => {
		const metrics = evaluateCorpus(RECEIPT_CAPTURE_CORPUS);
		const overBudgetFixtures = RECEIPT_CAPTURE_CORPUS.filter(
			(fixture) => evaluateCorpus([fixture]).correctionBudgetViolations > 0,
		).map((fixture) => fixture.id);
		console.info(
			JSON.stringify({
				schema: "ReceiptCorpusMetricsV1",
				...metrics,
				overBudgetFixtures,
			}),
		);
		expect(metrics.fixtureCount).toBeGreaterThanOrEqual(15);
		expect(metrics.fieldAccuracy).toBeGreaterThanOrEqual(0.98);
		expect(metrics.deadlineAccuracy).toBe(1);
		expect(metrics.confidenceBrierScore).toBeLessThanOrEqual(0.18);
		expect(metrics.refusalPrecision).toBe(1);
		expect(metrics.refusalRecall).toBe(1);
		expect(metrics.meanCorrectionFields).toBeLessThanOrEqual(1.2);
		expect(metrics.correctionBudgetViolations).toBe(0);
		expect(overBudgetFixtures).toEqual([]);
		expect(metrics.p95LatencyMs).toBeLessThan(50);
	});

	it("penalizes unexpected dated candidates in deadline accuracy", () => {
		const metrics = evaluateCorpus([
			{
				id: "unexpected-rebate-candidate",
				description: "A spurious dated candidate must reduce the accuracy score",
				locale: "en-US",
				documentKind: "fixture",
				lines: [
					{ text: "Metric Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 01/01/2026", confidence: 0.96, page: 1 },
					{ text: "Test Item $10.00", confidence: 0.96, page: 1 },
					{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
					{ text: "Rebate must be submitted by March 1, 2026.", confidence: 0.96, page: 1 },
				],
				expect: {
					candidates: [{ type: "return", date: "2026-01-31" }],
					state: "ready_for_confirmation",
					maxCorrectionFields: 0,
				},
			},
		]);

		expect(metrics.deadlineAccuracy).toBe(0.5);
	});

	it("scores a missing expected deadline as a zero-confidence outcome", () => {
		const metrics = evaluateCorpus([
			{
				id: "missing-expected-candidate",
				description: "A missing expected deadline must count against calibration",
				documentKind: "fixture",
				lines: [
					{ text: "Metric Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Test Item $10.00", confidence: 0.96, page: 1 },
				],
				expect: {
					candidates: [{ type: "return", date: "2026-01-31" }],
					state: "refused",
					maxCorrectionFields: 1,
				},
			},
		]);

		expect(metrics.confidenceBrierScore).toBe(1);
	});

	it("penalizes unexpected item facts in field accuracy", () => {
		const metrics = evaluateCorpus([
			{
				id: "unexpected-item-fact",
				description: "A spurious item must reduce the field accuracy score",
				locale: "en-US",
				documentKind: "fixture",
				lines: [
					{ text: "Metric Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 01/01/2026", confidence: 0.96, page: 1 },
					{ text: "Expected Item $10.00", confidence: 0.96, page: 1 },
					{ text: "Spurious Item $3.00", confidence: 0.96, page: 1 },
				],
				expect: {
					itemNames: ["Expected Item"],
					state: "refused",
					maxCorrectionFields: 0,
				},
			},
		]);

		expect(metrics.fieldAccuracy).toBe(0.5);
	});

	it.each([
		"Discount -$5.00",
		"Shipping $5.00",
		"Delivery fee $4.00",
		"Handling charge $2.00",
		"Tip $3.00",
		"Gratuity $3.00",
		"Service charge $2.50",
		"Coupon -$5.00",
		"Discount 10% $5.00",
		"10% Discount -$5.00",
		"Shipping and handling $5.00",
		"Delivery surcharge $4.00",
		"Processing fee $2.00",
		"Convenience fee $2.00",
		"Shipping & Handling $5.00",
		"Restocking fee $10.00",
		"Fuel surcharge $3.00",
		"Coupon savings -$5.00",
	])("does not extract a priced receipt adjustment as an item: %s", (adjustment) => {
		const result = extractReceiptCapture(
			[
				{ text: "Adjustment Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: adjustment, confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:receipt-adjustment", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.items).toEqual([]);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "missing", field: "items" }),
			]),
		);
	});

	it("retains a merchandise name that contains an adjustment word", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Packing Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Shipping Box $5.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:shipping-box", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.items.map((item) => item.name.value)).toEqual([
			"Shipping Box",
		]);
		expect(result.overallState).toBe("ready_for_confirmation");
	});

	it("pairs a standalone price with the nearest plausible item name", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Northstar Outfitters", confidence: 0.96, page: 1 },
				{ text: "Trail Bottle", confidence: 0.96, page: 1 },
				{ text: "$24.00", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:nearest-standalone-name", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.merchant.value).toBe("Northstar Outfitters");
		expect(result.receiptFacts.items.map((item) => item.name.value)).toEqual([
			"Trail Bottle",
		]);
	});

	it("aligns a block of standalone prices with the nearest item-name block", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Northstar Outfitters", confidence: 0.96, page: 1 },
				{ text: "Trail Bottle", confidence: 0.96, page: 1 },
				{ text: "Camp Mug", confidence: 0.96, page: 1 },
				{ text: "$24.00", confidence: 0.96, page: 1 },
				{ text: "$12.00", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:standalone-price-block", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.items.map((item) => item.name.value)).toEqual([
			"Trail Bottle",
			"Camp Mug",
		]);
	});

	it("does not pair a standalone price with text from a prior PDF page", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Paged Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Customer Service", confidence: 0.96, page: 1 },
				{ text: "$10.00", confidence: 0.96, page: 2 },
				{ text: "Returns within 30 days", confidence: 0.96, page: 2 },
			],
			{ sourceFingerprint: "fixture:cross-page-price", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.items).toHaveLength(0);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "missing", field: "items" }),
			]),
		);
	});

	it.each([
		{
			name: "merchant only",
			lines: ["Northstar Outfitters", "$24.00"],
			expectedItems: [],
		},
		{
			name: "one item and two prices",
			lines: ["Northstar Outfitters", "Trail Bottle", "$24.00", "$12.00"],
			expectedItems: ["Trail Bottle"],
		},
		{
			name: "two items and three prices",
			lines: [
				"Northstar Outfitters",
				"Trail Bottle",
				"Camp Mug",
				"$24.00",
				"$12.00",
				"$6.00",
			],
			expectedItems: ["Trail Bottle", "Camp Mug"],
		},
	])("never pairs the merchant when standalone counts mismatch: $name", ({ lines, expectedItems }) => {
		const result = extractReceiptCapture(
			[
				...lines.map((text) => ({ text, confidence: 0.96, page: 1 })),
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:standalone-count-mismatch", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.items.map((item) => item.name.value)).toEqual(
			expectedItems,
		);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "missing", field: "items" }),
			]),
		);
		expect(result.overallState).toBe("needs_correction");
	});

	it.each([
		"Returns within 30 days for a full refund.",
		"Returns within 30 days for store credit.",
		"Returns within 30 days for a replacement.",
		"Returns within 30 days for full store credit.",
		"Returns within 30 days for a replacement item.",
		"Returns within 30 days for merchandise credit.",
		"Returns within 30 days for store credit or replacement.",
		"Returns within 30 days for a refund or exchange.",
		"Returns within 30 days for a gift card.",
		"Returns within 30 days for a store gift card.",
		"Returns within 30 days for a refund to the original payment method.",
		"Returns within 30 days for a full refund to the original method of payment.",
		"Returns within 30 days for original payment method.",
		"Returns within 30 days for refund/exchange.",
	])("does not treat a refund remedy as an item category: %s", (policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Remedy Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:refund-remedy", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("prefers a labeled transaction date over unrelated ambiguous text", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Labelled Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-04-05", confidence: 0.96, page: 1 },
				{ text: "Reference period 04/05/2026", confidence: 0.96, page: 1 },
				{ text: "Storage Box $20.00", confidence: 0.96, page: 1 },
				{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:labeled-date", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.transactionDate.value).toBe("2026-04-05");
		expect(result.candidates[0]?.candidateDate).toBe("2026-05-05");
		expect(result.overallState).toBe("ready_for_confirmation");
	});

	it("inherits a transaction-date label onto an adjacent same-page date-only OCR line", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Split Label Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase Date", confidence: 0.96, page: 1 },
				{ text: "2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:adjacent-date-label", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.transactionDate.value).toBe("2026-01-01");
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("does not carry a transaction-date label across document pages", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Split Label Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase Date", confidence: 0.96, page: 1 },
				{ text: "2026-01-01", confidence: 0.96, page: 2 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 2 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 2 },
			],
			{ sourceFingerprint: "fixture:cross-page-date-label", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.transactionDate.value).toBeNull();
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
	});

	it.each(["Total Wine & More", "Cash & Carry", "The Exchange"])(
		"preserves a legitimate merchant name containing a receipt keyword: %s",
		(merchant) => {
			const result = extractReceiptCapture(
				[
					{ text: merchant, confidence: 0.96, page: 1 },
					{ text: "Downtown location", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
				],
				{ sourceFingerprint: "fixture:merchant-keyword", sourceKind: "fixture" },
			);

			expect(result.receiptFacts.merchant.value).toBe(merchant);
			expect(result.receiptFacts.merchant.issues).toEqual([]);
			expect(result.policyInterpretations).toHaveLength(1);
			expect(result.overallState).toBe("ready_for_confirmation");
		},
	);

	it("skips structural receipt and policy lines when selecting a merchant", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Receipt #123", confidence: 0.96, page: 1 },
				{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:merchant-structure", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.merchant.value).toBe("Harbor Goods");
	});

	it.each([
		"THANK YOU",
		"THANK YOU FOR SHOPPING WITH US",
		"THANKS FOR SHOPPING",
		"WELCOME",
		"WELCOME TO OUR STORE",
		"CUSTOMER COPY",
	])("skips a generic receipt header when selecting a merchant: %s", (header) => {
		const result = extractReceiptCapture(
			[
				{ text: header, confidence: 0.96, page: 1 },
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:generic-receipt-header", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.merchant.value).toBe("Harbor Goods");
	});

	it.each(["Returns & Exchanges", "Returns", "Return eligibility"])(
		"does not select or interpret a structural policy header as merchant content: %s",
		(header) => {
			const result = extractReceiptCapture(
				[
					{ text: header, confidence: 0.96, page: 1 },
					{ text: "Harbor Goods", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
				],
				{ sourceFingerprint: "fixture:policy-header", sourceKind: "fixture" },
			);

			expect(result.receiptFacts.merchant.value).toBe("Harbor Goods");
			expect(result.policyInterpretations).toHaveLength(1);
			expect(result.overallState).toBe("ready_for_confirmation");
		},
	);

	it("carries a bare policy header into its adjacent body line", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "RETURN POLICY", confidence: 0.96, page: 1 },
				{ text: "Within 30 days of purchase", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:split-policy-header", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations).toHaveLength(1);
		expect(result.policyInterpretations[0]?.evidence).toHaveLength(2);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("carries a bare policy header through contiguous policy body lines", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "RETURN POLICY", confidence: 0.96, page: 1 },
				{ text: "Within 30 days", confidence: 0.96, page: 1 },
				{ text: "Electronics within 15 days", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:multiline-policy-body", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations.map((policy) => policy.windowDays)).toEqual([
			30, 15,
		]);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it("stops inherited policy context at unrelated receipt content", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "RETURN POLICY", confidence: 0.96, page: 1 },
				{ text: "Within 30 days", confidence: 0.96, page: 1 },
				{ text: "Rewards points earned", confidence: 0.96, page: 1 },
				{ text: "Electronics within 15 days", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:policy-context-stop", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations).toHaveLength(1);
		expect(result.policyInterpretations[0]?.windowDays).toBe(30);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("does not treat an operational duration as policy evidence", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "RETURN POLICY", confidence: 0.96, page: 1 },
				{ text: "Store hours 9 days a week", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:operational-duration", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations).toHaveLength(0);
		expect(result.candidates).toHaveLength(0);
		expect(result.overallState).toBe("refused");
		expect(result.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "policy_not_found" })]),
		);
	});

	it("associates an exclusion after an inherited policy body with that policy", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "RETURN POLICY", confidence: 0.96, page: 1 },
				{ text: "Within 30 days", confidence: 0.96, page: 1 },
				{ text: "Except electronics", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:inherited-policy-exclusion", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations).toHaveLength(1);
		expect(result.policyInterpretations[0]?.exclusions).toContain("Except electronics");
		expect(result.candidates[0]?.state).toBe("needs_correction");
	});

	it("carries an explicit policy type into its contiguous qualified body", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days", confidence: 0.96, page: 1 },
				{ text: "Electronics within 15 days", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:typed-multiline-policy", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations.map((policy) => policy.windowDays)).toEqual([
			30, 15,
		]);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
	});

	it.each([
		["WARRANTY POLICY", "1 year from purchase", "warranty", "2027-01-01"],
		["REBATE PROGRAM", "Submit within 30 days of purchase", "rebate", "2026-01-31"],
		[
			"PRICE ADJUSTMENT POLICY",
			"Available within 14 days of purchase",
			"price_adjustment",
			"2026-01-15",
		],
	] as const)(
		"carries a split %s header into its adjacent body line",
		(header, body, type, expectedDate) => {
			const result = extractReceiptCapture(
				[
					{ text: "Harbor Goods", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{ text: header, confidence: 0.96, page: 1 },
					{ text: body, confidence: 0.96, page: 1 },
				],
				{ sourceFingerprint: `fixture:split-${type}-header`, sourceKind: "fixture" },
			);

			expect(result.policyInterpretations).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type,
						evidence: expect.arrayContaining([
							expect.objectContaining({ line: 3 }),
							expect.objectContaining({ line: 4 }),
						]),
					}),
				]),
			);
			expect(result.candidates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type,
						candidateDate: expectedDate,
						state: "ready_for_confirmation",
					}),
				]),
			);
		},
	);

	it.each([
		["RETURN POLICY", "Electronics within 30 days", "return"],
		["WARRANTY POLICY", "Electronics for 1 year", "warranty"],
		["REBATE PROGRAM", "Electronics within 30 days", "rebate"],
		[
			"PRICE ADJUSTMENT POLICY",
			"Electronics available within 14 days",
			"price_adjustment",
		],
	] as const)(
		"gates a category-qualified body inherited from %s",
		(header, body, type) => {
			const result = extractReceiptCapture(
				[
					{ text: "Hearthline Home", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Lounge Sofa $899.00", confidence: 0.96, page: 1 },
					{ text: header, confidence: 0.96, page: 1 },
					{ text: body, confidence: 0.96, page: 1 },
				],
				{
					sourceFingerprint: `fixture:split-category-${type}`,
					sourceKind: "fixture",
				},
			);

			const candidate = result.candidates.find((entry) => entry.type === type);
			expect(candidate?.state).toBe("needs_correction");
			expect(candidate?.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
			);
		},
	);

	it.each([
		["Return Policy: Electronics within 30 days", "return"],
		["Warranty Policy: Electronics for 1 year", "warranty"],
		["Rebate Policy: Electronics within 30 days", "rebate"],
		[
			"Price Adjustment Policy: Electronics available within 14 days",
			"price_adjustment",
		],
	] as const)("gates a same-line category-qualified header: %s", (policy, type) => {
		const result = extractReceiptCapture(
			[
				{ text: "Hearthline Home", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Lounge Sofa $899.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{
				sourceFingerprint: `fixture:same-line-category-${type}`,
				sourceKind: "fixture",
			},
		);

		const candidate = result.candidates.find((entry) => entry.type === type);
		expect(candidate?.state).toBe("needs_correction");
		expect(candidate?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it.each([
		["30-day returns", "return", "2026-01-31"],
		["2-week returns", "return", "2026-01-15"],
		["6-month warranty", "warranty", "2026-07-01"],
		["1-year warranty", "warranty", "2027-01-01"],
	] as const)("parses a hyphenated duration in %s", (policy, type, expectedDate) => {
		const result = extractReceiptCapture(
			[
				{ text: "Duration Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:hyphenated-duration", sourceKind: "fixture" },
		);

		expect(result.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type,
					candidateDate: expectedDate,
					state: "ready_for_confirmation",
				}),
			]),
		);
	});

	it.each([
		"Returns within 30.5 days",
		"Returns within 30,5 days",
		"Returns within 30 to 60 days",
		"Returns within 30-60 days",
		"Returns within 30/60 days",
		"Returns between 30 and 60 days",
		"Returns between 30 and up to 60 days",
		"Returns within 30 days or 60",
		"Returns within 30 days and 60",
		"Returns within 30 days to 60",
		"Returns within 30 days / 60",
		"Returns within 30 days or longer",
		"Returns within approximately 30 days",
		"Returns within about 30 days",
	])("refuses a fractional or ranged duration: %s", (policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Range Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:ambiguous-duration", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowDays).toBeNull();
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "conflicting" })]),
		);
	});

	it("keeps a qualified policy header out of merchant selection and preserves its ambiguity", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Returns & Exchanges: Electronics", confidence: 0.96, page: 1 },
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:qualified-policy-header", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.merchant.value).toBe("Harbor Goods");
		expect(result.policyInterpretations).toHaveLength(2);
		expect(result.candidates[0]?.state).toBe("needs_correction");
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it.each([
		"Return Policy - Electronics",
		"Returns for Electronics",
		"Return Policy for Electronics",
		"Returns on Electronics",
	])("preserves category ambiguity from a qualified policy header: %s", (header) => {
		const result = extractReceiptCapture(
			[
				{ text: header, confidence: 0.96, page: 1 },
				{ text: "Harbor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:qualified-policy-syntax", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.merchant.value).toBe("Harbor Goods");
		expect(result.policyInterpretations).toHaveLength(2);
		expect(result.candidates[0]?.state).toBe("needs_correction");
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it("preserves an ambiguous alternate policy date as a blocking issue", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Beacon Home", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-15", confidence: 0.96, page: 1 },
				{ text: "Table Lamp $48.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days or until 04/05/2026.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:ambiguous-policy-date", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "locale_ambiguous" })]),
		);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-02-14",
			state: "needs_correction",
		});
	});

	it("associates standalone exclusion evidence with the preceding policy", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Circuit Grove", confidence: 0.96, page: 1 },
				{ text: "Purchase date 02/01/2026", confidence: 0.96, page: 1 },
				{ text: "Tablet $299.00", confidence: 0.96, page: 1 },
				{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
				{ text: "Except electronics.", confidence: 0.96, page: 1 },
			],
			{
				locale: "en-US",
				sourceFingerprint: "fixture:standalone-exclusion",
				sourceKind: "fixture",
			},
		);

		expect(result.policyInterpretations[0]?.exclusions).toContain(
			"Except electronics.",
		);
		expect(result.policyInterpretations[0]?.evidence).toHaveLength(2);
		expect(result.candidates[0]?.state).toBe("needs_correction");
	});

	it.each([
		"Opened items are not returnable.",
		"Opened items are never returnable.",
		"Opened items cannot be returned.",
	])("associates a returnability exclusion with the preceding policy: %s", (exclusion) => {
		const result = extractReceiptCapture(
			[
				{ text: "Circuit Grove", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Tablet $299.00", confidence: 0.96, page: 1 },
				{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
				{ text: exclusion, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:returnability-exclusion", sourceKind: "fixture" },
		);

		expect(
			result.policyInterpretations.some((policy) =>
				policy.exclusions.includes(exclusion),
			),
		).toBe(true);
		expect(result.candidates[0]?.state).toBe("needs_correction");
	});

	it("retains every same-line policy window as a separate interpretation", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Modern Relay", confidence: 0.96, page: 1 },
				{ text: "Purchase date 03/01/2026", confidence: 0.96, page: 1 },
				{ text: "Bluetooth Speaker $89.00", confidence: 0.96, page: 1 },
				{
					text: "Electronics returns within 14 days; all other returns within 30 days.",
					confidence: 0.96,
					page: 1,
				},
			],
			{
				locale: "en-US",
				sourceFingerprint: "fixture:same-line-windows",
				sourceKind: "fixture",
			},
		);

		expect(result.policyInterpretations.map((policy) => policy.windowDays)).toEqual([
			14, 30,
		]);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
	});

	it("does not treat promotional holiday text or a holiday merchant as policy", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Holiday Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Holiday Mug $20.00", confidence: 0.96, page: 1 },
				{ text: "Holiday Sale 20% off", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:holiday-promotion", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.merchant.value).toBe("Holiday Market");
		expect(result.receiptFacts.items.map((item) => item.name.value)).toEqual([
			"Holiday Mug",
		]);
		expect(result.policyInterpretations).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("does not treat priced holiday window merchandise as policy", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Seasonal Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Holiday Window Display $20.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:holiday-window-item", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.items.map((item) => item.name.value)).toEqual([
			"Holiday Window Display",
		]);
		expect(result.policyInterpretations).toHaveLength(1);
		expect(result.overallState).toBe("ready_for_confirmation");
	});

	it("splits comma-separated policy types without losing either deadline", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Comma Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Travel Kettle $64.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days, warranty for 1 year.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:comma-policy-types", sourceKind: "fixture" },
		);

		expect(result.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "return",
					candidateDate: "2026-01-31",
					state: "ready_for_confirmation",
				}),
				expect.objectContaining({
					type: "warranty",
					candidateDate: "2027-01-01",
					state: "ready_for_confirmation",
				}),
			]),
		);
	});

	it("keeps an untyped duration continuation under the neighboring policy type", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Continuation Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Electronics Headphones $80.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days; electronics within 15 days",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:untyped-duration-continuation", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations.map((policy) => policy.windowDays)).toEqual(
			expect.arrayContaining([15, 30]),
		);
		const returnCandidate = result.candidates.find((candidate) => candidate.type === "return");
		expect(returnCandidate).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(returnCandidate?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it("preserves policy text and evidence after redacting a same-line address", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Continuation Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "123 Market Street Portland Returns within 30 days",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:address-policy-line", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.description).toContain("Returns within 30 days");
		expect(result.policyInterpretations[0]?.evidence[0]?.text).toContain(
			"Returns within 30 days",
		);
		expect(result.policyInterpretations[0]?.evidence[0]?.text).not.toContain(
			"123 Market Street Portland",
		);
	});

	it("keeps comma-separated categories correction-gated", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Category Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days for electronics, clothing.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:comma-categories", sourceKind: "fixture" },
		);

		expect(result.candidates[0]?.state).toBe("needs_correction");
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it.each([
		["warranty", "Electronics warranty for 1 year."],
		["rebate", "Electronics rebate must be submitted by December 31, 2026."],
		["price_adjustment", "Electronics price adjustment available within 14 days."],
	] as const)("gates an unmatched category-qualified %s policy", (type, policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Hearthline Home", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-12-01", confidence: 0.96, page: 1 },
				{ text: "Lounge Sofa $899.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: `fixture:category-${type}`, sourceKind: "fixture" },
		);

		expect(result.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type, state: "needs_correction" }),
			]),
		);
		expect(result.candidates.find((candidate) => candidate.type === type)?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it("gates a long category-qualified return policy", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Hearthline Home", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Lounge Sofa $899.00", confidence: 0.96, page: 1 },
				{
					text: "Home electronics and small appliances may be returned within 30 days.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:long-category-return", sourceKind: "fixture" },
		);

		expect(result.candidates[0]?.state).toBe("needs_correction");
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it("keeps a long generic item subject out of category qualification", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Hearthline Home", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Lounge Sofa $899.00", confidence: 0.96, page: 1 },
				{
					text: "Items in original condition with a receipt may be returned within 30 days.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:long-generic-return", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("refuses to infer a century from a two-digit transaction year", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Century Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 12/31/99", confidence: 0.96, page: 1 },
				{ text: "Storage Trunk $80.00", confidence: 0.96, page: 1 },
				{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
			],
			{
				locale: "en-US",
				sourceFingerprint: "fixture:two-digit-year",
				sourceKind: "fixture",
			},
		);

		expect(result.receiptFacts.transactionDate.value).toBeNull();
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "locale_ambiguous" })]),
		);
		});

	it("parses unambiguous day-first month-name transaction and policy dates", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Britannia Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date: 15 January 2026", confidence: 0.96, page: 1 },
				{ text: "Desk Clock £30.00", confidence: 0.96, page: 1 },
				{ text: "Returns until 15 February 2026", confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:day-first-month-name", sourceKind: "fixture" },
		);

		expect(result.receiptFacts.transactionDate.value).toBe("2026-01-15");
		expect(result.policyInterpretations[0]?.explicitDate).toBe("2026-02-15");
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-02-15",
			state: "ready_for_confirmation",
		});
	});

	it.each([
		"Returns are not accepted.",
		"Returns cannot be accepted.",
		"Returns will not be accepted.",
		"Returns won't be accepted.",
		"Returns may not be accepted.",
		"Returns aren't accepted.",
		"Returns aren’t accepted.",
		"Returns weren't accepted.",
		"Returns weren’t available.",
		"No refunds.",
		"Exchanges are prohibited.",
		"We do not accept returns.",
		"The store will not accept returns.",
		"We won't accept refunds.",
		"The merchant cannot accept exchanges.",
		"We will never accept returns.",
		"The store doesn't accept returns.",
		"The store did not accept returns.",
		"The store didn't accept returns.",
		"The store isn't accepting returns.",
		"The store was not accepting returns.",
		"The store wasn't accepting returns.",
		"The store has not accepted returns.",
		"The store hasn't accepted returns.",
		"The store had never accepted returns.",
		"The store hadn't accepted refunds.",
		"The store has not been accepting returns.",
		"The store hasn't been accepting returns.",
		"The store has been refusing returns.",
		"The store had been refusing refunds.",
		"The store is denying exchanges.",
		"The store had denied returns.",
		"The store may refuse returns.",
		"The store will deny refunds.",
		"The store could not accept returns.",
		"The store wouldn't accept returns.",
		"Returns would not be accepted.",
		"Returns might not be accepted.",
		"We aren’t accepting refunds.",
		"The merchant refuses refunds.",
		"Exchanges are denied.",
		"Returns were denied.",
		"Returns have been denied.",
		"Returns were refused.",
		"Returns were not accepted.",
		"Returns have not been accepted.",
		"Returns are being denied.",
		"All sales are final.",
	])("blocks a dated return policy when the document also says %s", (denial) => {
		const result = extractReceiptCapture(
			[
				{ text: "Final Word", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
				{ text: denial, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:return-denial", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it.each(["all sales are final.", "the item is non-returnable."])(
		"retains the same-line denial %s beside a dated policy",
		(denial) => {
			const result = extractReceiptCapture(
			[
				{ text: "Final Word", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: `Returns within 30 days; ${denial}`,
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:same-line-final-sale", sourceKind: "fixture" },
			);

			expect(result.policyInterpretations).toHaveLength(2);
			expect(result.candidates[0]).toMatchObject({
				candidateDate: "2026-01-31",
				state: "needs_correction",
			});
			expect(result.candidates[0]?.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
			);
		},
	);

	it("does not guess which same-line policy type an exclusion qualifies", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Mixed Policy Shop", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days; warranty for 1 year; except electronics.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:mixed-policy-exclusion", sourceKind: "fixture" },
		);

		expect(result.candidates.map((candidate) => [candidate.type, candidate.state])).toEqual(
			expect.arrayContaining([
				["return", "needs_correction"],
				["warranty", "needs_correction"],
			]),
		);
	});

	it("does not substitute purchase date for a receiving-date anchor", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Anchor Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days of receiving your order.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:receiving-anchor", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowAnchor).toBe("receipt_date");
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "missing" })]),
		);
	});

	it("recognizes a passive received-date anchor instead of using purchase date", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Anchor Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days after the order is received.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:passive-received-anchor", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowAnchor).toBe("receipt_date");
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "missing" })]),
		);
	});

	it("recognizes arrival as a delivery anchor instead of using purchase date", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Arrival Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days after arrival.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:arrival-anchor", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowAnchor).toBe("delivery_date");
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "missing" })]),
		);
	});

	it("does not substitute purchase date for a composite purchase-or-delivery anchor", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Composite Anchor Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days from the later of purchase or delivery.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:composite-delivery-anchor", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowAnchor).toBe("delivery_date");
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
	});

	it("treats refund ineligibility wording as an item-applicability exclusion", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Eligibility Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days.", confidence: 0.96, page: 1 },
				{
					text: "Opened goods are not eligible for a refund.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:refund-ineligibility", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.exclusions).toEqual(
			expect.arrayContaining(["Opened goods are not eligible for a refund."]),
		);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "needs_correction",
		});
	});

	it.each([
		"Extended warranty for 2 years from expiration of the manufacturer's warranty.",
		"Extended warranty for 2 years after the manufacturer's warranty expires.",
		"Extended warranty for 2 years following the prior warranty expiration.",
		"Extended warranty for 2 years from prior warranty expiry.",
		"Extended warranty for 2 years after the existing warranty has expired.",
		"Extended warranty for 2 years after the original warranty ends.",
		"Extended warranty for 2 years from original warranty ending.",
		"Extended warranty for 2 years after the prior warranty terminates.",
		"Extended warranty for 2 years after the standard warranty lapses.",
		"Extended warranty for 2 years after the cessation of the original warranty.",
		"Extended warranty for 2 years following warranty cessation.",
	])(
		"does not derive an extended warranty from purchase when it starts at prior expiry: %s",
		(policy) => {
			const result = extractReceiptCapture(
				[
					{ text: "Anchor Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{ text: policy, confidence: 0.96, page: 1 },
				],
				{
					sourceFingerprint: "fixture:prior-warranty-expiry-anchor",
					sourceKind: "fixture",
				},
			);

			expect(result.policyInterpretations[0]?.windowAnchor).toBe(
				"prior_policy_expiration_date",
			);
			expect(result.candidates[0]).toMatchObject({
				candidateDate: null,
				state: "needs_correction",
			});
		},
	);

	it.each([
		"Refunds are processed in 10 days.",
		"Refunds are processed within 10 days.",
		"Refunds credited within 10 days.",
		"Refunds posted within 10 days.",
		"Warranty repair takes 30 days.",
		"Warranty repair will be completed within 30 days.",
		"Warranty repair for 30 days.",
		"Warranty repair is available for 30 days.",
	])("does not treat operational timing as a deadline window: %s", (policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Service Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:operational-policy-timing", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowDays).toBeNull();
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "conflicting" })]),
		);
	});

	it.each([
		"Returns available after 30 days.",
		"Refunds become eligible after 30 days.",
		"Exchanges start 30 days after purchase.",
		"Warranty starts after 30 days.",
	])("does not treat an eligibility-start threshold as a deadline window: %s", (policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Threshold Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:eligibility-start-threshold", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowDays).toBeNull();
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "conflicting" })]),
		);
	});

	it.each([
		"Return policy: 30 days.",
		"Return period is 30 days.",
		"Warranty coverage: 1 year.",
	])("derives a declarative policy duration: %s", (policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Declarative Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:declarative-policy-duration", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.windowDays).not.toBeNull();
		expect(result.candidates[0]).toMatchObject({
			candidateDate: expect.any(String),
			state: "ready_for_confirmation",
		});
	});

	it("types a mixed-keyword clause from its operative return phrase", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Operative Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Rebate items may be returned within 30 days.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:operative-return-type", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]?.type).toBe("return");
		expect(result.candidates[0]).toMatchObject({
			type: "return",
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("derives a refund eligibility window described as available", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Refund Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Refunds are available within 30 days of purchase.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:refund-availability-window", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("does not treat generic return-policy metadata as an item category", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Metadata Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Return policy: Returns accepted within 30 days.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:generic-policy-header", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it.each(["mail", "email", "e-mail", "post", "courier"])(
		"does not treat transport wording 'by %s' as an explicit-date cue",
		(transport) => {
			const result = extractReceiptCapture(
				[
					{ text: "Transport Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{
						text: `Returns accepted by ${transport} within 30 days.`,
						confidence: 0.96,
						page: 1,
					},
				],
				{ sourceFingerprint: "fixture:transport-by", sourceKind: "fixture" },
			);

			expect(result.candidates[0]).toMatchObject({
				candidateDate: "2026-01-31",
				state: "ready_for_confirmation",
			});
		},
	);

	it("does not treat an unrelated negative receipt condition as a return denial", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Open Gate Shop", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days; receipt is not required.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:no-receipt-required", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it.each([
		"Returns accepted within 30 days, receipt is unavailable.",
		"Returns accepted within 30 days, the item is unavailable.",
		"Returns accepted within 30 days, final approval may be required.",
	])("does not treat an unrelated denial signal as a return denial: %s", (policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Open Gate Shop", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:unrelated-denial-signal", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "ready_for_confirmation",
		});
	});

	it("blocks an unparsed explicit policy-date alternative", () => {
		const result = extractReceiptCapture(
			[
				{ text: "January House", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Wall Hook $20.00", confidence: 0.96, page: 1 },
				{
					text: "Returns within 30 days or until January 31, 2026 or until the end of February.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:unparsed-alternative", sourceKind: "fixture" },
		);

		expect(result.candidates[0]).toMatchObject({
			candidateDate: "2026-01-31",
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "conflicting" })]),
		);
	});

	it.each([
		"before",
		"on or before",
		"no later than",
		"by no later than",
		"not after",
		"prior to",
	])(
		"treats %s as an explicit policy-date cue",
		(cue) => {
			const result = extractReceiptCapture(
				[
					{ text: "Cue Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Wall Hook $20.00", confidence: 0.96, page: 1 },
					{
						text: `Returns within 30 days or ${cue} March 1, 2026.`,
						confidence: 0.96,
						page: 1,
					},
				],
				{ sourceFingerprint: `fixture:cue-${cue}`, sourceKind: "fixture" },
			);

			expect(result.candidates[0]).toMatchObject({
				candidateDate: null,
				state: "needs_correction",
			});
			expect(result.candidates[0]?.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "conflicting" })]),
			);
		},
	);

	it.each([
		["delivery", "delivery_date"],
		["arrival", "delivery_date"],
		["shipment", "shipment_date"],
		["dispatch", "shipment_date"],
		["installation", "installation_date"],
		["manufacture date", "manufacture_date"],
		["activation", "activation_date"],
		["registration", "registration_date"],
		["receipt", "receipt_date"],
		["pickup", "receipt_date"],
		["collection", "receipt_date"],
		["replacement date", "replacement_date"],
		["exchange date", "exchange_date"],
	] as const)("does not substitute the transaction date for a %s anchor", (anchor, expected) => {
		const result = extractReceiptCapture(
			[
				{ text: "Anchor Goods", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: `Returns within 30 days of ${anchor}.`,
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: `fixture:anchor-${anchor}`, sourceKind: "fixture" },
		);

		expect(result.policyInterpretations[0]).toMatchObject({
			windowDays: 30,
			windowAnchor: expected,
		});
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "missing" })]),
		);
	});

	it("preserves every same-clause warranty duration as a conflicting alternative", () => {
		const result = extractReceiptCapture(
			[
				{ text: "Coverage Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{
					text: "Warranty for 1 year parts and 90 days labor.",
					confidence: 0.96,
					page: 1,
				},
			],
			{ sourceFingerprint: "fixture:warranty-duration-alternatives", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations.map((policy) => policy.windowDays)).toEqual([
			90, 365,
		]);
		expect(result.candidates[0]).toMatchObject({
			candidateDate: null,
			state: "needs_correction",
		});
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "multiple_deadlines" }),
				expect.objectContaining({ code: "conflicting" }),
			]),
		);
	});

	it.each([
		"Batteries are not covered by warranty.",
		"Batteries are excluded from warranty coverage.",
		"Warranty does not cover batteries.",
		"Warranty doesn't include batteries.",
		"Warranty coverage does not include batteries.",
		"Warranty excludes batteries.",
		"Warranty void if the seal is broken.",
		"Warranty is voided if the seal is broken.",
	])("requires item resolution for a warranty coverage denial: %s", (exclusion) => {
		const result = extractReceiptCapture(
			[
				{ text: "Coverage Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Battery Pack $30.00", confidence: 0.96, page: 1 },
				{ text: "Warranty for 1 year.", confidence: 0.96, page: 1 },
				{ text: exclusion, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:warranty-exclusion", sourceKind: "fixture" },
		);

		expect(result.candidates[0]?.state).toBe("needs_correction");
		expect(result.candidates[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "multiple_deadlines" })]),
		);
	});

	it.each([
		["manufactured", "manufacture_date"],
		["activated", "activation_date"],
		["registered", "registration_date"],
	] as const)(
		"does not substitute purchase date when coverage starts after the product is %s",
		(verb, expectedAnchor) => {
			const result = extractReceiptCapture(
				[
					{ text: "Coverage Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{
						text: `Warranty for 1 year after the product is ${verb}.`,
						confidence: 0.96,
						page: 1,
					},
				],
				{ sourceFingerprint: "fixture:product-anchor", sourceKind: "fixture" },
			);

			expect(result.policyInterpretations[0]?.windowAnchor).toBe(expectedAnchor);
			expect(result.candidates[0]).toMatchObject({
				candidateDate: null,
				state: "needs_correction",
			});
		},
	);

	it.each([
		["manufactured", "manufacture_date"],
		["activated", "activation_date"],
		["registered", "registration_date"],
	] as const)(
		"does not substitute purchase date after the product has been %s",
		(verb, expectedAnchor) => {
			const result = extractReceiptCapture(
				[
					{ text: "Coverage Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
					{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
					{
						text: `Warranty for 1 year after the product has been ${verb}.`,
						confidence: 0.96,
						page: 1,
					},
				],
				{ sourceFingerprint: "fixture:perfect-product-anchor", sourceKind: "fixture" },
			);

			expect(result.policyInterpretations[0]?.windowAnchor).toBe(expectedAnchor);
			expect(result.candidates[0]?.state).toBe("needs_correction");
		},
	);

	it.each([
		["Warranty for 1 year hardware and 6 months battery.", [6, 365]],
		["Warranty for 1 year hardware and 12 weeks labor.", [84, 365]],
	] as const)("preserves mixed warranty duration units: %s", (policy, expectedWindows) => {
		const result = extractReceiptCapture(
			[
				{ text: "Coverage Market", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: "fixture:mixed-duration-units", sourceKind: "fixture" },
		);

		expect(result.policyInterpretations.map((entry) => entry.windowDays)).toEqual(
			expectedWindows,
		);
		expect(result.candidates[0]?.state).toBe("needs_correction");
	});

	it.each([
		["return", "Returns accepted until April 30, 2026."],
		["rebate", "Rebate must be submitted by April 30, 2026."],
		["warranty", "Warranty expires on April 30, 2026."],
		["price_adjustment", "Price adjustment available until April 30, 2026."],
	] as const)("withholds an impossible explicit %s deadline", (type, policy) => {
		const result = extractReceiptCapture(
			[
				{ text: "Chronology Shop", confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-05-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: policy, confidence: 0.96, page: 1 },
			],
			{ sourceFingerprint: `fixture:chronology-${type}`, sourceKind: "fixture" },
		);

		expect(result.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type,
					candidateDate: null,
					state: "needs_correction",
				}),
			]),
		);
		expect(result.candidates.find((candidate) => candidate.type === type)?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "conflicting" })]),
		);
	});
});
