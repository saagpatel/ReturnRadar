import { describe, expect, it, vi } from "vitest";
import type { ConfirmDeadlineCaptureInput } from "./persistence";
import { confirmDeadlineCapture, validateConfirmation } from "./persistence";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => 1) }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

function validInput(): ConfirmDeadlineCaptureInput {
	return {
		confirmationIntent: "confirm_and_create",
		source: {
			fingerprint: "a".repeat(64),
			kind: "image",
			extractionToken: "00000000-0000-4000-8000-000000000001",
		},
		merchant: "Northstar Outfitters",
		transactionDate: "2026-01-15",
		deadlines: [
			{
				candidateId: "return-1",
				type: "return",
				title: "Trail Bottle return",
				dueDate: "2026-02-14",
				reviewed: true,
				evidence: [],
				correctedFields: [],
			},
		],
	};
}

describe("capture confirmation gate", () => {
	it("hands one reviewed payload to the native atomic confirmation command", async () => {
		const input = validInput();
		await confirmDeadlineCapture(input);

		expect(mocks.invoke).toHaveBeenCalledWith(
			"confirm_deadline_capture",
			expect.objectContaining({
				input: expect.objectContaining({
					confirmationIntent: "confirm_and_create",
					deadlines: [
						expect.objectContaining({
							deadlineType: "return",
							reviewed: true,
						}),
					],
				}),
			}),
		);
	});

	it("accepts an explicitly reviewed deadline", () => {
		expect(() => validateConfirmation(validInput())).not.toThrow();
	});

	it("rejects creation without the explicit confirmation intent", () => {
		const input = validInput();
		input.confirmationIntent = "not_confirmed";
		expect(() => validateConfirmation(input)).toThrow(/Explicit confirmation/);
	});

	it("rejects confirmation without a native extraction-session token", () => {
		const input = validInput();
		input.source.extractionToken = "frontend-invented";
		expect(() => validateConfirmation(input)).toThrow(/extraction token/);
	});

	it("rejects an unreviewed candidate even when the outer action is confirmed", () => {
		const input = validInput();
		input.deadlines[0].reviewed = false;
		expect(() => validateConfirmation(input)).toThrow(/Review every/);
	});

	it("rejects a missing or malformed corrected date", () => {
		const input = validInput();
		input.deadlines[0].dueDate = "tomorrow";
		expect(() => validateConfirmation(input)).toThrow(/explicit ISO date/);
	});

	it("rejects more deadlines than the native atomic limit", () => {
		const input = validInput();
		input.deadlines = Array.from({ length: 9 }, (_, index) => ({
			...input.deadlines[0],
			candidateId: `manual-${index + 1}`,
		}));
		expect(() => validateConfirmation(input)).toThrow(/no more than 8/);
	});

	it("rejects a title beyond the native character limit", () => {
		const input = validInput();
		input.deadlines[0].title = "x".repeat(201);
		expect(() => validateConfirmation(input)).toThrow(/at most 200 characters/);
	});

	it("rejects a merchant beyond the native character limit", () => {
		const input = validInput();
		input.merchant = "x".repeat(201);
		expect(() => validateConfirmation(input)).toThrow(/no more than 200 characters/);
	});
});
