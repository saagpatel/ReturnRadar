import { describe, expect, it, vi } from "vitest";
import { mapRebateRow } from "./use-rebates";

// Mock today's date for deterministic tests
vi.mock("date-fns", async () => {
	const actual = await vi.importActual("date-fns");
	return {
		...actual,
		// Keep all actual functions but we'll pass fixed dates through the row data
	};
});

// Helper to create a row with defaults
function makeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		purchase_id: 10,
		rebate_amount_cents: 1599,
		submission_deadline: "2099-12-31", // far future = always pending
		submission_status: "pending" as const,
		submitted_at: null,
		received_at: null,
		notes: null,
		purchase_item_name: "Test Item",
		...overrides,
	};
}

describe("mapRebateRow", () => {
	it("maps all snake_case fields to camelCase", () => {
		const result = mapRebateRow(makeRow());
		expect(result.id).toBe(1);
		expect(result.purchaseId).toBe(10);
		expect(result.purchaseItemName).toBe("Test Item");
		expect(result.rebateAmountCents).toBe(1599);
		expect(result.submissionDeadline).toBe("2099-12-31");
		expect(result.submittedAt).toBeUndefined();
		expect(result.receivedAt).toBeUndefined();
		expect(result.notes).toBeUndefined();
	});

	it("computes positive daysUntilDeadline for future deadline", () => {
		const result = mapRebateRow(makeRow({ submission_deadline: "2099-12-31" }));
		expect(result.daysUntilDeadline).toBeGreaterThan(0);
	});

	it("computes negative daysUntilDeadline for past deadline", () => {
		const result = mapRebateRow(makeRow({ submission_deadline: "2020-01-01" }));
		expect(result.daysUntilDeadline).toBeLessThan(0);
	});

	it("auto-expires pending rebates past deadline", () => {
		const result = mapRebateRow(
			makeRow({
				submission_deadline: "2020-01-01",
				submission_status: "pending",
			}),
		);
		expect(result.submissionStatus).toBe("expired");
	});

	it("preserves received status even if deadline passed", () => {
		const result = mapRebateRow(
			makeRow({
				submission_deadline: "2020-01-01",
				submission_status: "received",
			}),
		);
		expect(result.submissionStatus).toBe("received");
	});

	it("preserves submitted status when deadline in future", () => {
		const result = mapRebateRow(
			makeRow({
				submission_deadline: "2099-12-31",
				submission_status: "submitted",
			}),
		);
		expect(result.submissionStatus).toBe("submitted");
	});

	it("formats amountDisplay from cents", () => {
		const result = mapRebateRow(makeRow({ rebate_amount_cents: 1599 }));
		expect(result.amountDisplay).toBe("$15.99");
	});

	it("handles null purchase_item_name gracefully", () => {
		const result = mapRebateRow(makeRow({ purchase_item_name: null }));
		expect(result.purchaseItemName).toBe("Unknown");
	});
});
