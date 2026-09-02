import Database from "@tauri-apps/plugin-sql";
import initSql from "../migrations/0001_init.sql?raw";
import retailersSql from "../migrations/0002_retailers.sql?raw";
import warrantiesSql from "../migrations/0003_warranties.sql?raw";
import deadlineCapturesSql from "../migrations/0004_deadline_captures.sql?raw";

const MIGRATIONS = [
	{ version: 1, sql: initSql },
	{ version: 2, sql: retailersSql },
	{ version: 3, sql: warrantiesSql },
	{ version: 4, sql: deadlineCapturesSql },
] as const;

let dbPromise: Promise<Database> | null = null;

/**
 * Split a SQL string into individual statements.
 * Handles semicolons inside single-quoted string literals.
 */
export function splitSqlStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	let inString = false;

	for (let i = 0; i < sql.length; i++) {
		const char = sql[i];

		if (char === "'" && !inString) {
			inString = true;
			current += char;
		} else if (char === "'" && inString) {
			// Handle escaped quotes ('')
			if (i + 1 < sql.length && sql[i + 1] === "'") {
				current += "''";
				i++;
			} else {
				inString = false;
				current += char;
			}
		} else if (char === ";" && !inString) {
			const trimmed = current.trim();
			if (trimmed.length > 0) {
				statements.push(trimmed);
			}
			current = "";
		} else {
			current += char;
		}
	}

	const trimmed = current.trim();
	if (trimmed.length > 0) {
		statements.push(trimmed);
	}

	return statements;
}

async function runMigrations(database: Database): Promise<void> {
	// Bootstrap: ensure schema_version table exists
	await database.execute(
		"CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
	);

	// Get current version
	const rows = await database.select<{ version: number | null }[]>(
		"SELECT MAX(version) as version FROM schema_version",
	);
	const currentVersion = rows[0]?.version ?? 0;

	// Apply pending migrations in order
	for (const migration of MIGRATIONS) {
		if (migration.version > currentVersion) {
			const statements = splitSqlStatements(migration.sql);
			for (const statement of statements) {
				await database.execute(statement);
			}
		}
	}
}

export async function getDb(): Promise<Database> {
	if (dbPromise) return dbPromise;
	dbPromise = (async () => {
		const databaseUrl =
			import.meta.env.VITE_RETURNRADAR_DB_URL || "sqlite:return_radar.db";
		const database = await Database.load(databaseUrl);
		await database.execute("PRAGMA foreign_keys = ON");
		await runMigrations(database);
		return database;
	})().catch((error: unknown) => {
		// A later explicit retry should not inherit a rejected initialization.
		dbPromise = null;
		throw error;
	});
	return dbPromise;
}
