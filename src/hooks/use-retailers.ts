import { useEffect, useState } from "react";
import { getDb } from "@/lib/db";
import type { Retailer } from "@/types";

interface RetailerRow {
	id: number;
	name: string;
	default_return_days: number;
	notes: string | null;
}

export function useRetailers(): {
	retailers: Retailer[];
	loading: boolean;
} {
	const [retailers, setRetailers] = useState<Retailer[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			const db = await getDb();
			const rows = await db.select<RetailerRow[]>(
				"SELECT id, name, default_return_days, notes FROM retailers ORDER BY name",
			);

			if (!cancelled) {
				setRetailers(
					rows.map((row) => ({
						id: row.id,
						name: row.name,
						defaultReturnDays: row.default_return_days,
						notes: row.notes ?? undefined,
					})),
				);
				setLoading(false);
			}
		}

		load().catch((err: unknown) => {
			console.error("Failed to load retailers:", err);
			if (!cancelled) setLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	return { retailers, loading };
}
