import { describe, expect, it } from "vitest";
import {
	buildNotificationMessage,
	getNotificationTargetDates,
} from "./notifications";

describe("getNotificationTargetDates", () => {
	it("computes correct target dates", () => {
		const result = getNotificationTargetDates("2024-01-15");
		expect(result.sevenDay).toBe("2024-01-22");
		expect(result.oneDay).toBe("2024-01-16");
	});

	it("handles month boundary", () => {
		const result = getNotificationTargetDates("2024-01-25");
		expect(result.sevenDay).toBe("2024-02-01");
		expect(result.oneDay).toBe("2024-01-26");
	});

	it("handles year boundary", () => {
		const result = getNotificationTargetDates("2024-12-26");
		expect(result.sevenDay).toBe("2025-01-02");
		expect(result.oneDay).toBe("2024-12-27");
	});

	it("handles leap year", () => {
		const result = getNotificationTargetDates("2024-02-22");
		expect(result.sevenDay).toBe("2024-02-29");
		expect(result.oneDay).toBe("2024-02-23");
	});
});

describe("buildNotificationMessage", () => {
	it("builds purchase 7-day message", () => {
		const msg = buildNotificationMessage(
			"purchase",
			"MacBook Pro",
			"7 days",
			"Apple",
		);
		expect(msg.title).toBe("Return deadline in 7 days");
		expect(msg.body).toContain("MacBook Pro");
		expect(msg.body).toContain("Apple");
	});

	it("builds purchase 1-day message", () => {
		const msg = buildNotificationMessage(
			"purchase",
			"USB Cable",
			"tomorrow",
			"Amazon",
		);
		expect(msg.title).toBe("Return deadline tomorrow!");
		expect(msg.body).toContain("USB Cable");
		expect(msg.body).toContain("Amazon");
	});

	it("builds rebate 7-day message with amount", () => {
		const msg = buildNotificationMessage(
			"rebate",
			"Monitor",
			"7 days",
			undefined,
			"$50.00",
		);
		expect(msg.title).toBe("Rebate deadline in 7 days");
		expect(msg.body).toContain("Monitor");
		expect(msg.body).toContain("$50.00");
	});

	it("builds rebate 1-day message", () => {
		const msg = buildNotificationMessage(
			"rebate",
			"Keyboard",
			"tomorrow",
			undefined,
			"$20.00",
		);
		expect(msg.title).toBe("Rebate deadline tomorrow!");
		expect(msg.body).toContain("Keyboard");
	});

	it("handles missing retailer for purchase", () => {
		const msg = buildNotificationMessage("purchase", "Widget", "7 days");
		expect(msg.body).not.toContain("undefined");
		expect(msg.body).toContain("Widget");
	});

	it("builds warranty 7-day message", () => {
		const msg = buildNotificationMessage(
			"warranty",
			"MacBook Pro",
			"7 days",
			"Apple",
		);
		expect(msg.title).toBe("Warranty expiring in 7 days");
		expect(msg.body).toContain("MacBook Pro");
		expect(msg.body).toContain("Apple");
	});

	it("builds warranty 1-day message", () => {
		const msg = buildNotificationMessage(
			"warranty",
			"TV",
			"tomorrow",
			"Samsung",
		);
		expect(msg.title).toBe("Warranty expires tomorrow!");
		expect(msg.body).toContain("TV");
		expect(msg.body).toContain("Samsung");
	});
});
