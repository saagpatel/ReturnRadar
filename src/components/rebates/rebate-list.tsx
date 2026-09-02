import { Plus, Receipt } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useRebateContext } from "@/hooks/use-rebates";
import { cn } from "@/lib/utils";
import type { Rebate } from "@/types";
import { RebateListSkeleton } from "./rebate-list-skeleton";
import { RebateRow } from "./rebate-row";

type SortField =
	| "purchaseItemName"
	| "rebateAmountCents"
	| "submissionDeadline"
	| "daysUntilDeadline"
	| "submissionStatus";

type SortDirection = "asc" | "desc";

const columns: { field: SortField; label: string; className?: string }[] = [
	{ field: "purchaseItemName", label: "Linked Item" },
	{ field: "rebateAmountCents", label: "Amount", className: "text-right" },
	{ field: "submissionDeadline", label: "Deadline" },
	{ field: "daysUntilDeadline", label: "Days Left" },
	{ field: "submissionStatus", label: "Status" },
];

function sortRebates(
	rebates: Rebate[],
	field: SortField,
	direction: SortDirection,
): Rebate[] {
	return [...rebates].sort((a, b) => {
		const aVal = a[field];
		const bVal = b[field];
		const cmp =
			typeof aVal === "string" && typeof bVal === "string"
				? aVal.localeCompare(bVal)
				: (aVal as number) - (bVal as number);
		return direction === "asc" ? cmp : -cmp;
	});
}

export function RebateList({ onOpenModal }: { onOpenModal: () => void }) {
	const { rebates, loading } = useRebateContext();
	const [sortField, setSortField] = useState<SortField>("submissionDeadline");
	const [sortDir, setSortDir] = useState<SortDirection>("asc");

	const sorted = useMemo(
		() => sortRebates(rebates, sortField, sortDir),
		[rebates, sortField, sortDir],
	);

	function handleSort(field: SortField) {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("asc");
		}
	}

	if (loading) {
		return <RebateListSkeleton />;
	}

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h2 className="text-3xl font-extrabold tracking-tight">Rebates</h2>
				<Button onClick={onOpenModal} size="sm">
					<Plus className="size-4" />
					Add Rebate
				</Button>
			</div>

			{rebates.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 py-32">
					<Receipt className="size-16 text-muted-foreground/40" />
					<p className="text-muted-foreground">No rebates yet</p>
					<Button variant="outline" size="sm" onClick={onOpenModal}>
						<Plus className="size-4" />
						Add your first rebate
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
							</TableRow>
						</TableHeader>
						<TableBody>
							{sorted.map((rebate) => (
								<RebateRow key={rebate.id} rebate={rebate} />
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
