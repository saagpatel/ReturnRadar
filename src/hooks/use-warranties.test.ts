import { describe, expect, it } from "vitest";
import { mapWarrantyRow } from "./use-warranties";

function makeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		purchase_id: 10,
		item_name: "MacBook Pro",
		provider: "Apple",
		warranty_type: "standard",
		start_date: "2024-01-01",
		expiry_date: "2099-12-31",
		warranty_status: "active" as const,
		coverage_details: "Parts and labor",
		notes: null,
		purchase_item_name: "MacBook Pro 16-inch",
		...overrides,
	};
}

describe("mapWarrantyRow", () => {
	it("maps all snake_case fields to camelCase", () => {
		const result = mapWarrantyRow(makeRow());
		expect(result.id).toBe(1);
		expect(result.purchaseId).toBe(10);
		expect(result.purchaseItemName).toBe("MacBook Pro 16-inch");
		expect(result.itemName).toBe("MacBook Pro");
		expect(result.provider).toBe("Apple");
		expect(result.warrantyType).toBe("standard");
		expect(result.startDate).toBe("2024-01-01");
		expect(result.expiryDate).toBe("2099-12-31");
		expect(result.coverageDetails).toBe("Parts and labor");
		expect(result.notes).toBeUndefined();
	});

	it("computes positive daysUntilExpiry for future", () => {
		const result = mapWarrantyRow(makeRow({ expiry_date: "2099-12-31" }));
		expect(result.daysUntilExpiry).toBeGreaterThan(0);
	});

	it("computes negative daysUntilExpiry for past", () => {
		const result = mapWarrantyRow(makeRow({ expiry_date: "2020-01-01" }));
		expect(result.daysUntilExpiry).toBeLessThan(0);
	});

	it("auto-computes expired when active + past date", () => {
		const result = mapWarrantyRow(
			makeRow({ expiry_date: "2020-01-01", warranty_status: "active" }),
		);
		expect(result.warrantyStatus).toBe("expired");
	});

	it("auto-computes expiring when active + 1-7 days", () => {
		// Use a date ~3 days from now
		const soon = new Date();
		soon.setDate(soon.getDate() + 3);
		const soonISO = soon.toISOString().split("T")[0];

		const result = mapWarrantyRow(
			makeRow({ expiry_date: soonISO, warranty_status: "active" }),
		);
		expect(result.warrantyStatus).toBe("expiring");
	});

	it("preserves claimed status regardless of date", () => {
		const result = mapWarrantyRow(
			makeRow({ expiry_date: "2020-01-01", warranty_status: "claimed" }),
		);
		expect(result.warrantyStatus).toBe("claimed");
	});

	it("handles null purchase_item_name", () => {
		const result = mapWarrantyRow(makeRow({ purchase_item_name: null }));
		expect(result.purchaseItemName).toBeUndefined();
	});

	it("handles null coverage_details", () => {
		const result = mapWarrantyRow(makeRow({ coverage_details: null }));
		expect(result.coverageDetails).toBeUndefined();
	});
});
