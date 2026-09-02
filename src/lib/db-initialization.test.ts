import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const database = {
		execute: vi.fn(async () => ({ rowsAffected: 0 })),
		select: vi.fn(async () => [{ version: 4 }]),
	};
	return {
		database,
		load: vi.fn(async () => database),
	};
});

vi.mock("@tauri-apps/plugin-sql", () => ({
	default: { load: mocks.load },
}));

describe("database initialization", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.load.mockClear();
		mocks.database.execute.mockClear();
		mocks.database.select.mockClear();
	});

	it("shares one migration lifecycle across concurrent callers", async () => {
		const { getDb } = await import("./db");
		const [first, second, third] = await Promise.all([getDb(), getDb(), getDb()]);

		expect(mocks.load).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
		expect(second).toBe(third);
	});
});
