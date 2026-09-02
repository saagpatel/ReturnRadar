import { Camera, Package, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { usePurchaseContext } from "@/hooks/use-purchases";
import { cn } from "@/lib/utils";
import type { Purchase } from "@/types";
import { AddPurchaseModal } from "./add-purchase-modal";
import { DeletePurchaseDialog } from "./delete-purchase-dialog";
import { PurchaseCard } from "./purchase-card";
import { PurchaseListSkeleton } from "./purchase-list-skeleton";

type SortField =
	| "itemName"
	| "retailerDisplay"
	| "purchaseDate"
	| "returnDeadline"
	| "daysUntilReturn"
	| "returnStatus"
	| "priceCents";

type SortDirection = "asc" | "desc";

const columns: {
	field: SortField;
	label: string;
	className?: string;
}[] = [
	{ field: "itemName", label: "Item" },
	{ field: "retailerDisplay", label: "Retailer" },
	{ field: "purchaseDate", label: "Purchased" },
	{ field: "returnDeadline", label: "Return By" },
	{ field: "daysUntilReturn", label: "Days Left" },
	{ field: "returnStatus", label: "Status" },
	{ field: "priceCents", label: "Price", className: "text-right" },
];

function sortPurchases(
	purchases: Purchase[],
	field: SortField,
	direction: SortDirection,
): Purchase[] {
	return [...purchases].sort((a, b) => {
		const aVal = a[field];
		const bVal = b[field];
		const cmp =
			typeof aVal === "string" && typeof bVal === "string"
				? aVal.localeCompare(bVal)
				: (aVal as number) - (bVal as number);
		return direction === "asc" ? cmp : -cmp;
	});
}

export function PurchaseList({
	onOpenModal,
	onOpenImport,
}: {
	onOpenModal: () => void;
	onOpenImport: () => void;
}) {
	const { purchases, loading, refetch } = usePurchaseContext();
	const [sortField, setSortField] = useState<SortField>("returnDeadline");
	const [sortDir, setSortDir] = useState<SortDirection>("asc");
	const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
	const [deletingPurchase, setDeletingPurchase] = useState<Purchase | null>(
		null,
	);

	const sorted = useMemo(
		() => sortPurchases(purchases, sortField, sortDir),
		[purchases, sortField, sortDir],
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
		setEditingPurchase(null);
		refetch().catch(console.error);
	}, [refetch]);

	const handleDeleted = useCallback(() => {
		setDeletingPurchase(null);
	}, []);

	if (loading) {
		return <PurchaseListSkeleton />;
	}

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h2 className="text-3xl font-extrabold tracking-tight">Purchases</h2>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={onOpenImport}>
						<Camera className="size-4" />
						Capture deadlines
					</Button>
					<Button onClick={onOpenModal} size="sm">
						<Plus className="size-4" />
						Add Purchase
					</Button>
				</div>
			</div>

			{purchases.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 py-32">
					<Package className="size-16 text-muted-foreground/40" />
					<p className="text-muted-foreground">No purchases yet</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={onOpenImport}>
							<Camera className="size-4" />
							Capture from document
						</Button>
						<Button variant="outline" size="sm" onClick={onOpenModal}>
							<Plus className="size-4" />
							Add manually
						</Button>
					</div>
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
											col.className,
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
							{sorted.map((purchase) => (
								<PurchaseCard
									key={purchase.id}
									purchase={purchase}
									onEdit={setEditingPurchase}
									onDelete={setDeletingPurchase}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Edit modal (separate from the Cmd+N add modal in App.tsx) */}
			<AddPurchaseModal
				open={!!editingPurchase}
				onOpenChange={(open) => {
					if (!open) setEditingPurchase(null);
				}}
				onSaved={handleEditSaved}
				editPurchase={editingPurchase ?? undefined}
			/>

			<DeletePurchaseDialog
				purchase={deletingPurchase}
				onOpenChange={(open) => {
					if (!open) setDeletingPurchase(null);
				}}
				onDeleted={handleDeleted}
			/>
		</div>
	);
}
