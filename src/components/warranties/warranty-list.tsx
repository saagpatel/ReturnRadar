import { Plus, Shield } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useWarrantyContext } from "@/hooks/use-warranties";
import { cn } from "@/lib/utils";
import type { Warranty } from "@/types";
import { AddWarrantyModal } from "./add-warranty-modal";
import { DeleteWarrantyDialog } from "./delete-warranty-dialog";
import { WarrantyCard } from "./warranty-card";
import { WarrantyListSkeleton } from "./warranty-list-skeleton";

type SortField =
	| "itemName"
	| "provider"
	| "warrantyType"
	| "startDate"
	| "expiryDate"
	| "daysUntilExpiry"
	| "warrantyStatus";

type SortDirection = "asc" | "desc";

const columns: { field: SortField; label: string }[] = [
	{ field: "itemName", label: "Item" },
	{ field: "provider", label: "Provider" },
	{ field: "warrantyType", label: "Type" },
	{ field: "startDate", label: "Started" },
	{ field: "expiryDate", label: "Expires" },
	{ field: "daysUntilExpiry", label: "Days Left" },
	{ field: "warrantyStatus", label: "Status" },
];

function sortWarranties(
	warranties: Warranty[],
	field: SortField,
	direction: SortDirection,
): Warranty[] {
	return [...warranties].sort((a, b) => {
		const aVal = a[field];
		const bVal = b[field];
		const cmp =
			typeof aVal === "string" && typeof bVal === "string"
				? aVal.localeCompare(bVal)
				: (aVal as number) - (bVal as number);
		return direction === "asc" ? cmp : -cmp;
	});
}

export function WarrantyList({ onOpenModal }: { onOpenModal: () => void }) {
	const { warranties, loading, refetch } = useWarrantyContext();
	const [sortField, setSortField] = useState<SortField>("expiryDate");
	const [sortDir, setSortDir] = useState<SortDirection>("asc");
	const [editingWarranty, setEditingWarranty] = useState<Warranty | null>(null);
	const [deletingWarranty, setDeletingWarranty] = useState<Warranty | null>(
		null,
	);

	const sorted = useMemo(
		() => sortWarranties(warranties, sortField, sortDir),
		[warranties, sortField, sortDir],
	);

	function handleSort(field: SortField) {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("asc");
		}
	}

	const handleEditSaved = useCallback(() => {
		setEditingWarranty(null);
		refetch().catch(console.error);
	}, [refetch]);

	const handleDeleted = useCallback(() => {
		setDeletingWarranty(null);
	}, []);

	if (loading) {
		return <WarrantyListSkeleton />;
	}

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h2 className="text-3xl font-extrabold tracking-tight">Warranties</h2>
				<Button onClick={onOpenModal} size="sm">
					<Plus className="size-4" />
					Add Warranty
				</Button>
			</div>

			{warranties.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 py-32">
					<Shield className="size-16 text-muted-foreground/40" />
					<p className="text-muted-foreground">No warranties tracked</p>
					<Button variant="outline" size="sm" onClick={onOpenModal}>
						<Plus className="size-4" />
						Add your first warranty
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								{columns.map((col) => (
									<TableHead
										key={col.field}
										className={cn(
											"cursor-pointer select-none hover:text-foreground",
										)}
										onClick={() => handleSort(col.field)}
									>
										{col.label}
										{sortField === col.field && (
											<span className="ml-1">
												{sortDir === "asc" ? "↑" : "↓"}
											</span>
										)}
									</TableHead>
								))}
								<TableHead className="w-10" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{sorted.map((warranty) => (
								<WarrantyCard
									key={warranty.id}
									warranty={warranty}
									onEdit={setEditingWarranty}
									onDelete={setDeletingWarranty}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<AddWarrantyModal
				open={!!editingWarranty}
				onOpenChange={(open) => {
					if (!open) setEditingWarranty(null);
				}}
				onSaved={handleEditSaved}
				editWarranty={editingWarranty ?? undefined}
			/>

			<DeleteWarrantyDialog
				warranty={deletingWarranty}
				onOpenChange={(open) => {
					if (!open) setDeletingWarranty(null);
				}}
				onDeleted={handleDeleted}
			/>
		</div>
	);
}
