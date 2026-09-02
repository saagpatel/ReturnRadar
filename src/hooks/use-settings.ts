import { useCallback, useEffect, useState } from "react";
import { getDb } from "@/lib/db";
import type { AppSettings, ThemePreference } from "@/types";

const DEFAULT_SETTINGS: AppSettings = {
	defaultReturnDays: 30,
	notify7day: true,
	notify1day: true,
	notificationPermissionRequested: false,
	theme: "system",
};

const KEY_MAP: Record<string, keyof AppSettings> = {
	default_return_days: "defaultReturnDays",
	notify_7day: "notify7day",
	notify_1day: "notify1day",
	notification_permission_requested: "notificationPermissionRequested",
	theme: "theme",
};

function parseSettingValue(
	key: string,
	value: string,
): boolean | number | string {
	if (key === "default_return_days") return Number(value);
	if (key === "theme") return value as ThemePreference;
	return value === "true";
}

function applyTheme(theme: ThemePreference) {
	const isDark =
		theme === "dark" ||
		(theme === "system" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);

	document.documentElement.classList.toggle("dark", isDark);
}

export function useSettings(): {
	settings: AppSettings;
	loading: boolean;
	updateSetting: (key: string, value: string) => Promise<void>;
} {
	const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		const db = await getDb();
		const rows = await db.select<{ key: string; value: string }[]>(
			"SELECT key, value FROM app_settings",
		);

		const parsed = { ...DEFAULT_SETTINGS };
		for (const row of rows) {
			const field = KEY_MAP[row.key];
			if (field) {
				const val = parseSettingValue(row.key, row.value);
				if (typeof val === "number" && field === "defaultReturnDays") {
					parsed.defaultReturnDays = val;
				} else if (typeof val === "string" && field === "theme") {
					parsed.theme = val as ThemePreference;
				} else if (typeof val === "boolean") {
					if (field === "notify7day") parsed.notify7day = val;
					if (field === "notify1day") parsed.notify1day = val;
					if (field === "notificationPermissionRequested")
						parsed.notificationPermissionRequested = val;
				}
			}
		}

		setSettings(parsed);
		applyTheme(parsed.theme);
		setLoading(false);
	}, []);

	useEffect(() => {
		load().catch((err: unknown) => {
			console.error("Failed to load settings:", err);
			setLoading(false);
		});
	}, [load]);

	// Listen for system theme changes when in "system" mode
	useEffect(() => {
		if (settings.theme !== "system") return;

		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		function handleChange() {
			applyTheme("system");
		}
		mq.addEventListener("change", handleChange);
		return () => mq.removeEventListener("change", handleChange);
	}, [settings.theme]);

	const updateSetting = useCallback(
		async (key: string, value: string) => {
			const db = await getDb();

			// Insert or update — theme may not exist in DB yet
			const existing = await db.select<{ key: string }[]>(
				"SELECT key FROM app_settings WHERE key = ?",
				[key],
			);
			if (existing.length === 0) {
				await db.execute(
					"INSERT INTO app_settings (key, value) VALUES (?, ?)",
					[key, value],
				);
			} else {
				await db.execute(
					"UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?",
					[value, key],
				);
			}

			// Keep "Other" retailer in sync with default_return_days
			if (key === "default_return_days") {
				await db.execute(
					"UPDATE retailers SET default_return_days = ? WHERE name = 'Other'",
					[Number(value)],
				);
			}

			// Apply theme immediately
			if (key === "theme") {
				applyTheme(value as ThemePreference);
			}

			await load();
		},
		[load],
	);

	return { settings, loading, updateSetting };
}
