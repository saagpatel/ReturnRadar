import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from "@tauri-apps/plugin-notification";
import { addDays, format, parseISO } from "date-fns";
import { getDb } from "./db";

type EntityType = "purchase" | "rebate" | "warranty";

/**
 * Compute the target dates for 7-day and 1-day notifications.
 */
export function getNotificationTargetDates(today: string): {
	sevenDay: string;
	oneDay: string;
} {
	const todayDate = parseISO(today);
	return {
		sevenDay: format(addDays(todayDate, 7), "yyyy-MM-dd"),
		oneDay: format(addDays(todayDate, 1), "yyyy-MM-dd"),
	};
}

/**
 * Build notification title and body for a deadline alert.
 */
export function buildNotificationMessage(
	entityType: EntityType,
	itemName: string,
	daysLabel: "7 days" | "tomorrow",
	retailer?: string,
	amount?: string,
): { title: string; body: string } {
	if (entityType === "purchase") {
		const location = retailer ? ` to ${retailer}` : "";
		return daysLabel === "tomorrow"
			? {
					title: "Return deadline tomorrow!",
					body: `Last day to return ${itemName}${location}`,
				}
			: {
					title: "Return deadline in 7 days",
					body: `Your return window for ${itemName}${location} expires in 7 days`,
				};
	}

	if (entityType === "warranty") {
		const providerStr = retailer ? ` ${retailer}` : "";
		return daysLabel === "tomorrow"
			? {
					title: "Warranty expires tomorrow!",
					body: `Your${providerStr} warranty for ${itemName} expires tomorrow`,
				}
			: {
					title: "Warranty expiring in 7 days",
					body: `Your${providerStr} warranty for ${itemName} expires in 7 days`,
				};
	}

	const amountStr = amount ? ` ${amount}` : "";
	return daysLabel === "tomorrow"
		? {
				title: "Rebate deadline tomorrow!",
				body: `Last day to submit${amountStr} rebate for ${itemName}`,
			}
		: {
				title: "Rebate deadline in 7 days",
				body: `Submit your${amountStr} rebate for ${itemName} within 7 days`,
			};
}

/**
 * Request notification permission on first launch.
 * Sets app_settings.notification_permission_requested to 'true' after requesting.
 */
export async function requestNotificationPermissionIfNeeded(): Promise<void> {
	const db = await getDb();
	const rows = await db.select<{ value: string }[]>(
		"SELECT value FROM app_settings WHERE key = 'notification_permission_requested'",
	);
	if (rows[0]?.value === "true") return;

	const granted = await isPermissionGranted();
	if (!granted) {
		await requestPermission();
	}

	await db.execute(
		"UPDATE app_settings SET value = 'true', updated_at = CURRENT_TIMESTAMP WHERE key = 'notification_permission_requested'",
	);
}

interface NotificationTarget {
	entityType: EntityType;
	entityId: number;
	itemName: string;
	retailerName?: string;
	amount?: string;
	notificationType: "7day" | "1day";
	daysLabel: "7 days" | "tomorrow";
}

/**
 * Check for approaching deadlines and fire notifications with dedup.
 */
export async function checkAndFireDeadlineNotifications(): Promise<void> {
	const db = await getDb();

	// Read notification settings
	const settings = await db.select<{ key: string; value: string }[]>(
		"SELECT key, value FROM app_settings WHERE key IN ('notify_7day', 'notify_1day')",
	);
	const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));
	const notify7day = settingsMap.notify_7day !== "false";
	const notify1day = settingsMap.notify_1day !== "false";

	if (!notify7day && !notify1day) return;

	const granted = await isPermissionGranted();
	if (!granted) return;

	const today = format(new Date(), "yyyy-MM-dd");
	const targets = getNotificationTargetDates(today);
	const notifications: NotificationTarget[] = [];

	// Find purchases with approaching deadlines
	if (notify7day) {
		const purchases = await db.select<
			{ id: number; item_name: string; retailer_name: string | null }[]
		>(
			`SELECT p.id, p.item_name, r.name as retailer_name
			FROM purchases p
			LEFT JOIN retailers r ON p.retailer_id = r.id
			WHERE p.return_deadline = ? AND p.return_status IN ('open', 'expiring')`,
			[targets.sevenDay],
		);
		for (const p of purchases) {
			notifications.push({
				entityType: "purchase",
				entityId: p.id,
				itemName: p.item_name,
				retailerName: p.retailer_name ?? undefined,
				notificationType: "7day",
				daysLabel: "7 days",
			});
		}
	}

	if (notify1day) {
		const purchases = await db.select<
			{ id: number; item_name: string; retailer_name: string | null }[]
		>(
			`SELECT p.id, p.item_name, r.name as retailer_name
			FROM purchases p
			LEFT JOIN retailers r ON p.retailer_id = r.id
			WHERE p.return_deadline = ? AND p.return_status IN ('open', 'expiring')`,
			[targets.oneDay],
		);
		for (const p of purchases) {
			notifications.push({
				entityType: "purchase",
				entityId: p.id,
				itemName: p.item_name,
				retailerName: p.retailer_name ?? undefined,
				notificationType: "1day",
				daysLabel: "tomorrow",
			});
		}
	}

	// Find rebates with approaching deadlines
	if (notify7day) {
		const rebates = await db.select<
			{ id: number; rebate_amount_cents: number; item_name: string }[]
		>(
			`SELECT r.id, r.rebate_amount_cents, p.item_name
			FROM rebates r
			LEFT JOIN purchases p ON r.purchase_id = p.id
			WHERE r.submission_deadline = ? AND r.submission_status IN ('pending', 'submitted')`,
			[targets.sevenDay],
		);
		for (const r of rebates) {
			notifications.push({
				entityType: "rebate",
				entityId: r.id,
				itemName: r.item_name ?? "Unknown",
				amount: `$${(r.rebate_amount_cents / 100).toFixed(2)}`,
				notificationType: "7day",
				daysLabel: "7 days",
			});
		}
	}

	if (notify1day) {
		const rebates = await db.select<
			{ id: number; rebate_amount_cents: number; item_name: string }[]
		>(
			`SELECT r.id, r.rebate_amount_cents, p.item_name
			FROM rebates r
			LEFT JOIN purchases p ON r.purchase_id = p.id
			WHERE r.submission_deadline = ? AND r.submission_status IN ('pending', 'submitted')`,
			[targets.oneDay],
		);
		for (const r of rebates) {
			notifications.push({
				entityType: "rebate",
				entityId: r.id,
				itemName: r.item_name ?? "Unknown",
				amount: `$${(r.rebate_amount_cents / 100).toFixed(2)}`,
				notificationType: "1day",
				daysLabel: "tomorrow",
			});
		}
	}

	// Find warranties with approaching expiry
	if (notify7day) {
		const warranties = await db.select<
			{ id: number; item_name: string; provider: string }[]
		>(
			`SELECT id, item_name, provider FROM warranties
			WHERE expiry_date = ? AND warranty_status IN ('active', 'expiring')`,
			[targets.sevenDay],
		);
		for (const w of warranties) {
			notifications.push({
				entityType: "warranty",
				entityId: w.id,
				itemName: w.item_name,
				retailerName: w.provider,
				notificationType: "7day",
				daysLabel: "7 days",
			});
		}
	}

	if (notify1day) {
		const warranties = await db.select<
			{ id: number; item_name: string; provider: string }[]
		>(
			`SELECT id, item_name, provider FROM warranties
			WHERE expiry_date = ? AND warranty_status IN ('active', 'expiring')`,
			[targets.oneDay],
		);
		for (const w of warranties) {
			notifications.push({
				entityType: "warranty",
				entityId: w.id,
				itemName: w.item_name,
				retailerName: w.provider,
				notificationType: "1day",
				daysLabel: "tomorrow",
			});
		}
	}

	// Fire notifications with dedup check
	for (const n of notifications) {
		const existing = await db.select<{ id: number }[]>(
			`SELECT id FROM notification_log
			WHERE entity_type = ? AND entity_id = ? AND notification_type = ?`,
			[n.entityType, n.entityId, n.notificationType],
		);

		if (existing.length === 0) {
			const msg = buildNotificationMessage(
				n.entityType,
				n.itemName,
				n.daysLabel,
				n.retailerName,
				n.amount,
			);
			sendNotification({ title: msg.title, body: msg.body });

			await db.execute(
				`INSERT INTO notification_log (entity_type, entity_id, notification_type)
				VALUES (?, ?, ?)`,
				[n.entityType, n.entityId, n.notificationType],
			);
		}
	}
}
