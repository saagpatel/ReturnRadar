import { describe, expect, it } from "vitest";
import { calculateStatus, daysUntil, getReturnDeadline } from "./deadlines";

describe("daysUntil", () => {
	it("returns positive days for future deadline", () => {
		expect(daysUntil("2024-02-14", "2024-01-15")).toBe(30);
	});

	it("returns 7 for exactly 7 days away", () => {
		expect(daysUntil("2024-01-22", "2024-01-15")).toBe(7);
	});

	it("returns 1 for tomorrow", () => {
		expect(daysUntil("2024-01-16", "2024-01-15")).toBe(1);
	});

	it("returns 0 when deadline is today", () => {
		expect(daysUntil("2024-01-15", "2024-01-15")).toBe(0);
	});

	it("returns -1 for yesterday", () => {
		expect(daysUntil("2024-01-14", "2024-01-15")).toBe(-1);
	});

	it("returns large negative for long-expired", () => {
		expect(daysUntil("2023-12-16", "2024-01-15")).toBe(-30);
	});
});

describe("calculateStatus", () => {
	it("returns 'open' for 30 days remaining", () => {
		expect(calculateStatus("2024-02-14", "2024-01-15")).toBe("open");
	});

	it("returns 'open' for 8 days remaining (just outside expiring)", () => {
		expect(calculateStatus("2024-01-23", "2024-01-15")).toBe("open");
	});

	it("returns 'expiring' for exactly 7 days", () => {
		expect(calculateStatus("2024-01-22", "2024-01-15")).toBe("expiring");
	});

	it("returns 'expiring' for 1 day remaining", () => {
		expect(calculateStatus("2024-01-16", "2024-01-15")).toBe("expiring");
	});

	it("returns 'expired' for deadline = today (0 days)", () => {
		expect(calculateStatus("2024-01-15", "2024-01-15")).toBe("expired");
	});

	it("returns 'expired' for -1 day", () => {
		expect(calculateStatus("2024-01-14", "2024-01-15")).toBe("expired");
	});

	it("returns 'expired' for -30 days", () => {
		expect(calculateStatus("2023-12-16", "2024-01-15")).toBe("expired");
	});
});

describe("getReturnDeadline", () => {
	it("adds days correctly", () => {
		expect(getReturnDeadline("2024-01-15", 30)).toBe("2024-02-14");
	});

	it("handles leap year (Feb 28 + 1 = Feb 29)", () => {
		expect(getReturnDeadline("2024-02-28", 1)).toBe("2024-02-29");
	});

	it("handles year boundary", () => {
		expect(getReturnDeadline("2024-12-20", 30)).toBe("2025-01-19");
	});

	it("handles 0-day window", () => {
		expect(getReturnDeadline("2024-01-15", 0)).toBe("2024-01-15");
	});
});
