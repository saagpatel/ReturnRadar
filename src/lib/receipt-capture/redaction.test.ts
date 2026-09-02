import { describe, expect, it } from "vitest";
import { redactSensitiveText, sanitizeDocumentLabel } from "./redaction";

describe("receipt evidence redaction", () => {
	it("redacts payment cards, addresses, loyalty IDs, and transaction IDs", () => {
		const text = [
			"Card 4111 1111 1111 1111",
			"Visa ending 4242",
			"123 Market Street Portland",
			"Loyalty ID MEMBER-88291",
			"Transaction # ABCD-1234",
		].join("\n");
		const redacted = redactSensitiveText(text);
		expect(redacted).not.toContain("4111");
		expect(redacted).not.toContain("4242");
		expect(redacted).not.toContain("123 Market Street");
		expect(redacted).not.toContain("MEMBER-88291");
		expect(redacted).not.toContain("ABCD-1234");
	});

	it("stops card-fragment redaction before a following policy duration", () => {
		expect(redactSensitiveText("Visa 4242 90-day returns")).toBe(
			"[PAYMENT CARD REDACTED] 90-day returns",
		);
		expect(redactSensitiveText("Visa ending 4242 Returns within 30 days")).toBe(
			"[PAYMENT CARD REDACTED] Returns within 30 days",
		);
		expect(redactSensitiveText("Visa ending in 4242 Returns within 30 days")).toBe(
			"[PAYMENT CARD REDACTED] Returns within 30 days",
		);
	});

	it("stops full-card redaction before a following policy duration", () => {
		expect(
			redactSensitiveText("Card 4111 1111 1111 1111 90-day returns"),
		).toBe("Card [PAYMENT CARD REDACTED] 90-day returns");
	});

	it("redacts short and punctuated labeled transaction identifiers", () => {
		const redacted = redactSensitiveText(
			"Receipt # 12/3456 Returns within 30 days; Order: 123; Invoice #ABC123; Member # 7/82",
		);
		expect(redacted).not.toContain("12/3456");
		expect(redacted).not.toContain("123");
		expect(redacted).not.toContain("ABC123");
		expect(redacted).not.toContain("7/82");
		expect(redacted).toContain("Returns within 30 days");
		expect(redacted.match(/TRANSACTION IDENTIFIER REDACTED/g)).toHaveLength(3);
		expect(redacted.match(/LOYALTY IDENTIFIER REDACTED/g)).toHaveLength(1);
	});

	it("redacts identifiers after conventionally punctuated label markers", () => {
		const redacted = redactSensitiveText(
			"Receipt No. 12/3456; Order No. 123; Member No. 7/82; Receipt No . 34/5678; Receipt No., 56/7890",
		);
		expect(redacted).not.toContain("12/3456");
		expect(redacted).not.toContain("Order No. 123");
		expect(redacted).not.toContain("7/82");
		expect(redacted).not.toContain("34/5678");
		expect(redacted).not.toContain("56/7890");
		expect(redacted.match(/TRANSACTION IDENTIFIER REDACTED/g)).toHaveLength(4);
		expect(redacted.match(/LOYALTY IDENTIFIER REDACTED/g)).toHaveLength(1);
	});

	it.each([
		"Receipt required for returns within 30 days",
		"Order must be returned within 30 days",
		"Member benefits remain available",
	])("preserves policy prose after an identifier-like label: %s", (policy) => {
		expect(redactSensitiveText(policy)).toBe(policy);
	});

	it("preserves policy evidence following an address on the same OCR line", () => {
		const redacted = redactSensitiveText(
			"123 Market Street Portland Returns within 30 days",
		);
		expect(redacted).toBe("[ADDRESS REDACTED] Returns within 30 days");
		expect(redacted).not.toContain("123 Market Street Portland");
	});

	it("preserves a policy duration that precedes a street address", () => {
		expect(
			redactSensitiveText("Returns within 30 days at 123 Market Street"),
		).toBe("Returns within 30 days at [ADDRESS REDACTED]");
	});

	it("does not redact a duration followed by a street-named location", () => {
		expect(
			redactSensitiveText("Returns within 30 days at Main Street locations"),
		).toBe("Returns within 30 days at Main Street locations");
	});

	it.each([
		["123 Market Street 30-day returns", "[ADDRESS REDACTED] 30-day returns"],
		[
			"123 Market Street Opened items may not be returned",
			"[ADDRESS REDACTED] Opened items may not be returned",
		],
		[
			"123 Market Street Opened items are not returnable",
			"[ADDRESS REDACTED] Opened items are not returnable",
		],
	] as const)("preserves the full policy tail after an address: %s", (input, expected) => {
		expect(redactSensitiveText(input)).toBe(expected);
	});

	it.each(["Court", "Circle", "Terrace", "Parkway", "Highway"])(
		"redacts an address ending in %s while preserving same-line policy evidence",
		(suffix) => {
			const redacted = redactSensitiveText(
				`42 Pine ${suffix} Returns within 30 days`,
			);
			expect(redacted).toBe("[ADDRESS REDACTED] Returns within 30 days");
			expect(redacted).not.toContain(`42 Pine ${suffix}`);
		},
	);

	it.each([
		"No returns accepted for opened electronics",
		"Not covered by warranty after misuse",
		"Except electronics returns are accepted within 30 days",
		"Excluded from the warranty coverage",
		"Store does not accept returns for opened items",
		"We deny refunds for clearance items",
		"Not included under warranty after misuse",
	])("preserves a policy denial or exclusion after an address: %s", (policy) => {
		const redacted = redactSensitiveText(`123 Market Street Portland ${policy}`);
		expect(redacted).toBe(`[ADDRESS REDACTED] ${policy}`);
	});

	it("redacts every address on a policy-bearing OCR line", () => {
		expect(
			redactSensitiveText(
				"123 Market Street Returns accepted; 456 Oak Road",
			),
		).toBe("[ADDRESS REDACTED] Returns accepted; [ADDRESS REDACTED]");
	});

	it("stores a generic source label instead of a private filename", () => {
		expect(sanitizeDocumentLabel("pdf", "a1b2c3d4e5f6")).toBe("PDF • a1b2c3d4e5");
	});
});
