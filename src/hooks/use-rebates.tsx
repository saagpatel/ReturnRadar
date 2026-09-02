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
import { centsToDollars, dollarsToCents } from "@/lib/format";
import type { Rebate, RebateFormInput, RebateStatus } from "@/types";

interface RebateRow {
	id: number;
	purchase_id: number;
	rebate_amount_cents: number;
	submission_deadline: string;
	submission_status: RebateStatus;
	submitted_at: string | null;
	received_at: string | null;
	notes: string | null;
	purchase_item_name: string | null;
}

function todayISO(): string {
	return format(new Date(), "yyyy-MM-dd");
}

export function mapRebateRow(row: RebateRow): Rebate {
	const today = todayISO();
	const dbStatus = row.submission_status;

	// Auto-expire pending rebates past deadline; preserve submitted/received as-is
	const computedStatus =
		dbStatus === "pending" && daysUntil(row.submission_deadline, today) <= 0
			? "expired"
			: dbStatus;

	return {
		id: row.id,
		purchaseId: row.purchase_id,
		purchaseItemName: row.purchase_item_name ?? "Unknown",
		rebateAmountCents: row.rebate_amount_cents,
		amountDisplay: centsToDollars(row.rebate_amount_cents),
		submissionDeadline: row.submission_deadline,
		submissionStatus: computedStatus,
		daysUntilDeadline: daysUntil(row.submission_deadline, today),
		submittedAt: row.submitted_at ?? undefined,
		receivedAt: row.received_at ?? undefined,
		notes: row.notes ?? undefined,
	};
}

export interface UseRebatesReturn {
	rebates: Rebate[];
	loading: boolean;
	refetch: () => Promise<void>;
	getByPurchase: (purchaseId: number) => Rebate[];
	addRebate: (input: RebateFormInput) => Promise<void>;
	updateStatus: (id: number, status: RebateStatus) => Promise<void>;
	deleteRebate: (id: number) => Promise<void>;
}

export function useRebates(): UseRebatesReturn {
	const [rebates, setRebates] = useState<Rebate[]>([]);
	const [loading, setLoading] = useState(true);

	const refetch = useCallback(async () => {
		const db = await getDb();
		const rows = await db.select<RebateRow[]>(
			`SELECT r.id, r.purchase_id, r.rebate_amount_cents, r.submission_deadline,
				r.submission_status, r.submitted_at, r.received_at, r.notes,
				p.item_name as purchase_item_name
			FROM rebates r
			LEFT JOIN purchases p ON r.purchase_id = p.id
			ORDER BY r.submission_deadline ASC`,
		);
		setRebates(rows.map(mapRebateRow));
		setLoading(false);
	}, []);

	useEffect(() => {
		refetch().catch((err: unknown) => {
			console.error("Failed to load rebates:", err);
			setLoading(false);
		});
	}, [refetch]);

	const addRebate = useCallback(
		async (input: RebateFormInput) => {
			const db = await getDb();
			const amountCents = dollarsToCents(input.rebateAmountDollars);

			await db.execute(
				`INSERT INTO rebates (purchase_id, rebate_amount_cents, submission_deadline, notes)
				VALUES (?, ?, ?, ?)`,
				[
					input.purchaseId,
					amountCents,
					input.submissionDeadline,
					input.notes ?? null,
				],
			);

			await refetch();
		},
		[refetch],
	);

	const updateStatus = useCallback(
		async (id: number, status: RebateStatus) => {
			const db = await getDb();
			const today = todayISO();
			const sets = ["submission_status = ?", "updated_at = CURRENT_TIMESTAMP"];
			const values: unknown[] = [status];

			if (status === "submitted") {
				sets.push("submitted_at = ?");
				values.push(today);
			} else if (status === "received") {
				sets.push("received_at = ?");
				values.push(today);
			}

			values.push(id);
			await db.execute(
				`UPDATE rebates SET ${sets.join(", ")} WHERE id = ?`,
				values,
			);

			await refetch();
		},
		[refetch],
	);

	const deleteRebate = useCallback(
		async (id: number) => {
			const db = await getDb();
			await db.execute("DELETE FROM rebates WHERE id = ?", [id]);
			await refetch();
		},
		[refetch],
	);

	const getByPurchase = useCallback(
		(purchaseId: number): Rebate[] => {
			return rebates.filter((r) => r.purchaseId === purchaseId);
		},
		[rebates],
	);

	return {
		rebates,
		loading,
		refetch,
		getByPurchase,
		addRebate,
		updateStatus,
		deleteRebate,
	};
}

// Context for sharing rebate state across routes
const RebateContext = createContext<UseRebatesReturn | null>(null);

export function RebateProvider({ children }: { children: React.ReactNode }) {
	const value = useRebates();
	return <RebateContext value={value}>{children}</RebateContext>;
}

export function useRebateContext(): UseRebatesReturn {
	const ctx = useContext(RebateContext);
	if (!ctx) {
		throw new Error("useRebateContext must be used within RebateProvider");
	}
	return ctx;
}
