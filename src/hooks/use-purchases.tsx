import { format } from "date-fns";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { getDb } from "@/lib/db";
import { calculateStatus, daysUntil, getReturnDeadline } from "@/lib/deadlines";
import { centsToDollars, dollarsToCents } from "@/lib/format";
import type { Purchase, PurchaseFormInput, ReturnStatus } from "@/types";

interface PurchaseRow {
	id: number;
	item_name: string;
	retailer_id: number | null;
	retailer_name_override: string | null;
	purchase_date: string;
	price_cents: number;
	return_window_days: number;
	return_deadline: string;
	return_status: ReturnStatus;
	notes: string | null;
	retailer_name: string | null;
}

function todayISO(): string {
	return format(new Date(), "yyyy-MM-dd");
}

function mapRow(row: PurchaseRow): Purchase {
	const today = todayISO();
	const dbStatus = row.return_status;
	// Manual overrides ('returned', 'kept') are preserved; others are computed
	const computedStatus =
		dbStatus === "returned" || dbStatus === "kept"
			? dbStatus
			: calculateStatus(row.return_deadline, today);

	return {
		id: row.id,
		itemName: row.item_name,
		retailerId: row.retailer_id ?? undefined,
		retailerNameOverride: row.retailer_name_override ?? undefined,
		retailerDisplay:
			row.retailer_name ?? row.retailer_name_override ?? "Unknown",
		purchaseDate: row.purchase_date,
		priceCents: row.price_cents,
		priceDisplay: centsToDollars(row.price_cents),
		returnWindowDays: row.return_window_days,
		returnDeadline: row.return_deadline,
		returnStatus: computedStatus,
		daysUntilReturn: daysUntil(row.return_deadline, today),
		notes: row.notes ?? undefined,
	};
}

export interface UsePurchasesReturn {
	purchases: Purchase[];
	loading: boolean;
	refetch: () => Promise<void>;
	addPurchase: (input: PurchaseFormInput) => Promise<void>;
	updatePurchase: (
		id: number,
		input: Partial<PurchaseFormInput>,
	) => Promise<void>;
	updateStatus: (id: number, status: ReturnStatus) => Promise<void>;
	deletePurchase: (id: number) => Promise<void>;
}

export function usePurchases(): UsePurchasesReturn {
	const [purchases, setPurchases] = useState<Purchase[]>([]);
	const [loading, setLoading] = useState(true);

	const refetch = useCallback(async () => {
		const db = await getDb();
		const rows = await db.select<PurchaseRow[]>(
			`SELECT p.id, p.item_name, p.retailer_id, p.retailer_name_override,
				p.purchase_date, p.price_cents, p.return_window_days, p.return_deadline,
				p.return_status, p.notes, r.name as retailer_name
			FROM purchases p
			LEFT JOIN retailers r ON p.retailer_id = r.id
			ORDER BY p.return_deadline ASC`,
		);
		setPurchases(rows.map(mapRow));
		setLoading(false);
	}, []);

	useEffect(() => {
		refetch().catch((err: unknown) => {
			console.error("Failed to load purchases:", err);
			setLoading(false);
		});
	}, [refetch]);

	const addPurchase = useCallback(
		async (input: PurchaseFormInput) => {
			const db = await getDb();
			const priceCents = dollarsToCents(input.priceDollars);
			const returnDeadline = getReturnDeadline(
				input.purchaseDate,
				input.returnWindowDays,
			);

			await db.execute(
				`INSERT INTO purchases (item_name, retailer_id, retailer_name_override,
				purchase_date, price_cents, return_window_days, return_deadline, notes)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					input.itemName,
					input.retailerId ?? null,
					input.retailerNameOverride ?? null,
					input.purchaseDate,
					priceCents,
					input.returnWindowDays,
					returnDeadline,
					input.notes ?? null,
				],
			);

			await refetch();
		},
		[refetch],
	);

	const updatePurchase = useCallback(
		async (id: number, input: Partial<PurchaseFormInput>) => {
			const db = await getDb();
			const sets: string[] = [];
			const values: unknown[] = [];

			if (input.itemName !== undefined) {
				sets.push("item_name = ?");
				values.push(input.itemName);
			}
			if (input.retailerId !== undefined) {
				sets.push("retailer_id = ?");
				values.push(input.retailerId);
			}
			if (input.retailerNameOverride !== undefined) {
				sets.push("retailer_name_override = ?");
				values.push(input.retailerNameOverride);
			}
			if (input.purchaseDate !== undefined) {
				sets.push("purchase_date = ?");
				values.push(input.purchaseDate);
			}
			if (input.priceDollars !== undefined) {
				sets.push("price_cents = ?");
				values.push(dollarsToCents(input.priceDollars));
			}
			if (input.returnWindowDays !== undefined) {
				sets.push("return_window_days = ?");
				values.push(input.returnWindowDays);
			}

			// Recompute deadline if date or window changed
			if (
				input.purchaseDate !== undefined ||
				input.returnWindowDays !== undefined
			) {
				const current = purchases.find((p) => p.id === id);
				const date = input.purchaseDate ?? current?.purchaseDate ?? todayISO();
				const window =
					input.returnWindowDays ?? current?.returnWindowDays ?? 30;
				sets.push("return_deadline = ?");
				values.push(getReturnDeadline(date, window));
			}

			if (sets.length === 0) return;

			sets.push("updated_at = CURRENT_TIMESTAMP");
			values.push(id);

			await db.execute(
				`UPDATE purchases SET ${sets.join(", ")} WHERE id = ?`,
				values,
			);

			await refetch();
		},
		[refetch, purchases],
	);

	const updateStatus = useCallback(
		async (id: number, status: ReturnStatus) => {
			const db = await getDb();
			await db.execute(
				"UPDATE purchases SET return_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
				[status, id],
			);
			await refetch();
		},
		[refetch],
	);

	const deletePurchase = useCallback(
		async (id: number) => {
			const db = await getDb();
			await db.execute("DELETE FROM purchases WHERE id = ?", [id]);
			await refetch();
		},
		[refetch],
	);

	return {
		purchases,
		loading,
		refetch,
		addPurchase,
		updatePurchase,
		updateStatus,
		deletePurchase,
	};
}

// Context for sharing purchase state across routes
const PurchaseContext = createContext<UsePurchasesReturn | null>(null);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
	const value = usePurchases();
	return <PurchaseContext value={value}>{children}</PurchaseContext>;
}

export function usePurchaseContext(): UsePurchasesReturn {
	const ctx = useContext(PurchaseContext);
	if (!ctx) {
		throw new Error("usePurchaseContext must be used within PurchaseProvider");
	}
	return ctx;
}
