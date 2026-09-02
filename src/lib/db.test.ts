import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./db";

describe("splitSqlStatements", () => {
	it("splits simple statements on semicolons", () => {
		const sql = "CREATE TABLE foo (id INTEGER); INSERT INTO foo VALUES (1);";
		const result = splitSqlStatements(sql);
		expect(result).toEqual([
			"CREATE TABLE foo (id INTEGER)",
			"INSERT INTO foo VALUES (1)",
		]);
	});

	it("handles whitespace and newlines between statements", () => {
		const sql = `
      CREATE TABLE foo (id INTEGER);

      INSERT INTO foo VALUES (1);
    `;
		const result = splitSqlStatements(sql);
		expect(result).toEqual([
			"CREATE TABLE foo (id INTEGER)",
			"INSERT INTO foo VALUES (1)",
		]);
	});

	it("ignores empty statements from trailing semicolons", () => {
		const sql = "SELECT 1; ; SELECT 2;";
		const result = splitSqlStatements(sql);
		expect(result).toEqual(["SELECT 1", "SELECT 2"]);
	});

	it("handles statements without trailing semicolons", () => {
		const sql = "SELECT 1";
		const result = splitSqlStatements(sql);
		expect(result).toEqual(["SELECT 1"]);
	});

	it("preserves semicolons inside single-quoted strings", () => {
		const sql = "INSERT INTO foo (name) VALUES ('hello; world'); SELECT 1;";
		const result = splitSqlStatements(sql);
		expect(result).toEqual([
			"INSERT INTO foo (name) VALUES ('hello; world')",
			"SELECT 1",
		]);
	});

	it("handles escaped single quotes (SQL doubled quotes)", () => {
		const sql =
			"INSERT INTO foo (name) VALUES ('Lowe''s'); INSERT INTO bar VALUES (1);";
		const result = splitSqlStatements(sql);
		expect(result).toEqual([
			"INSERT INTO foo (name) VALUES ('Lowe''s')",
			"INSERT INTO bar VALUES (1)",
		]);
	});

	it("handles the actual 0001_init migration SQL", () => {
		const sql = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO schema_version (version) VALUES (1);
    `;
		const result = splitSqlStatements(sql);
		expect(result).toHaveLength(3);
		expect(result[0]).toContain("schema_version");
		expect(result[1]).toContain("app_settings");
		expect(result[2]).toContain("INSERT INTO schema_version");
	});

	it("handles the retailers seed with escaped quotes", () => {
		const sql = `
INSERT OR IGNORE INTO retailers (name, default_return_days) VALUES
  ('Amazon', 30),
  ('Lowe''s', 90),
  ('Other', 30);

INSERT INTO schema_version (version) VALUES (2);
    `;
		const result = splitSqlStatements(sql);
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("Lowe''s");
		expect(result[1]).toContain("VALUES (2)");
	});

	it("returns empty array for empty input", () => {
		expect(splitSqlStatements("")).toEqual([]);
		expect(splitSqlStatements("   \n  ")).toEqual([]);
	});
});
