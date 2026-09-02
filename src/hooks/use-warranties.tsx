import { format } from "date-fns";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { getDb } from "@/lib/db";
import { daysUntil } from "@/lib/deadlines";
import type { Warranty, WarrantyFormInput, WarrantyStatus } from "@/types";

interface WarrantyRow {
	id: number;
	purchase_id: number | null;
	item_name: string;
	provider: string;
	warranty_type: string;
	start_date: string;
	expiry_date: string;
	warranty_status: WarrantyStatus;
	coverage_details: string | null;
	notes: string | null;
	purchase_item_name: string | null;
}

function todayISO(): string {
	return format(new Date(), "yyyy-MM-dd");
}

export function mapWarrantyRow(row: WarrantyRow): Warranty {
	const today = todayISO();
	const dbStatus = row.warranty_status;
	const days = daysUntil(row.expiry_date, today);

	// 'claimed' is a manual override; others are computed
	let computedStatus: WarrantyStatus;
	if (dbStatus === "claimed") {
		computedStatus = "claimed";
	} else if (days <= 0) {
		computedStatus = "expired";
	} else if (days <= 7) {
		computedStatus = "expiring";
	} else {
		computedStatus = "active";
	}

	return {
		id: row.id,
		purchaseId: row.purchase_id ?? undefined,
		purchaseItemName: row.purchase_item_name ?? undefined,
		itemName: row.item_name,
		provider: row.provider,
		warrantyType: row.warranty_type as Warranty["warrantyType"],
		startDate: row.start_date,
		expiryDate: row.expiry_date,
		warrantyStatus: computedStatus,
		daysUntilExpiry: days,
		coverageDetails: row.coverage_details ?? undefined,
		notes: row.notes ?? undefined,
	};
}

export interface UseWarrantiesReturn {
	warranties: Warranty[];
	loading: boolean;
	refetch: () => Promise<void>;
	addWarranty: (input: WarrantyFormInput) => Promise<void>;
	updateWarranty: (
		id: number,
		input: Partial<WarrantyFormInput>,
	) => Promise<void>;
	updateStatus: (id: number, status: WarrantyStatus) => Promise<void>;
	deleteWarranty: (id: number) => Promise<void>;
}

export function useWarranties(): UseWarrantiesReturn {
	const [warranties, setWarranties] = useState<Warranty[]>([]);
	const [loading, setLoading] = useState(true);

	const refetch = useCallback(async () => {
		const db = await getDb();
		const rows = await db.select<WarrantyRow[]>(
			`SELECT w.id, w.purchase_id, w.item_name, w.provider, w.warranty_type,
				w.start_date, w.expiry_date, w.warranty_status, w.coverage_details,
				w.notes, p.item_name as purchase_item_name
			FROM warranties w
			LEFT JOIN purchases p ON w.purchase_id = p.id
			ORDER BY w.expiry_date ASC`,
		);
		setWarranties(rows.map(mapWarrantyRow));
		setLoading(false);
	}, []);

	useEffect(() => {
		refetch().catch((err: unknown) => {
			console.error("Failed to load warranties:", err);
			setLoading(false);
		});
	}, [refetch]);

	const addWarranty = useCallback(
		async (input: WarrantyFormInput) => {
			const db = await getDb();
			await db.execute(
				`INSERT INTO warranties (purchase_id, item_name, provider, warranty_type,
				start_date, expiry_date, coverage_details, notes)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					input.purchaseId ?? null,
					input.itemName,
					input.provider,
					input.warrantyType,
					input.startDate,
					input.expiryDate,
					input.coverageDetails ?? null,
					input.notes ?? null,
				],
			);
			await refetch();
		},
		[refetch],
	);

	const updateWarranty = useCallback(
		async (id: number, input: Partial<WarrantyFormInput>) => {
			const db = await getDb();
			const sets: string[] = [];
			const values: unknown[] = [];

			if (input.itemName !== undefined) {
				sets.push("item_name = ?");
				values.push(input.itemName);
			}
			if (input.provider !== undefined) {
				sets.push("provider = ?");
				values.push(input.provider);
			}
			if (input.warrantyType !== undefined) {
				sets.push("warranty_type = ?");
				values.push(input.warrantyType);
			}
			if (input.startDate !== undefined) {
				sets.push("start_date = ?");
				values.push(input.startDate);
			}
			if (input.expiryDate !== undefined) {
				sets.push("expiry_date = ?");
				values.push(input.expiryDate);
			}
			if (input.coverageDetails !== undefined) {
				sets.push("coverage_details = ?");
				values.push(input.coverageDetails);
			}
			if (input.purchaseId !== undefined) {
				sets.push("purchase_id = ?");
				values.push(input.purchaseId);
			}

			if (sets.length === 0) return;

			sets.push("updated_at = CURRENT_TIMESTAMP");
			values.push(id);

			await db.execute(
				`UPDATE warranties SET ${sets.join(", ")} WHERE id = ?`,
				values,
			);
			await refetch();
		},
		[refetch],
	);

	const updateStatus = useCallback(
		async (id: number, status: WarrantyStatus) => {
			const db = await getDb();
			await db.execute(
				"UPDATE warranties SET warranty_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
				[status, id],
			);
			await refetch();
		},
		[refetch],
	);

	const deleteWarranty = useCallback(
		async (id: number) => {
			const db = await getDb();
			await db.execute("DELETE FROM warranties WHERE id = ?", [id]);
			await refetch();
		},
		[refetch],
	);

	return {
		warranties,
		loading,
		refetch,
		addWarranty,
		updateWarranty,
		updateStatus,
		deleteWarranty,
	};
}

// Context for sharing warranty state across routes
const WarrantyContext = createContext<UseWarrantiesReturn | null>(null);

export function WarrantyProvider({ children }: { children: React.ReactNode }) {
	const value = useWarranties();
	return <WarrantyContext value={value}>{children}</WarrantyContext>;
}

export function useWarrantyContext(): UseWarrantiesReturn {
	const ctx = useContext(WarrantyContext);
	if (!ctx) {
		throw new Error("useWarrantyContext must be used within WarrantyProvider");
	}
	return ctx;
}
