import {
	MoreHorizontal,
	PackageCheck,
	PackageMinus,
	Pencil,
	Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { usePurchaseContext } from "@/hooks/use-purchases";
import { formatDate, formatDaysLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Purchase, ReturnStatus } from "@/types";

const statusConfig: Record<ReturnStatus, { label: string; className: string }> =
	{
		open: {
			label: "Open",
			className:
				"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-transparent",
		},
		expiring: {
			label: "Expiring",
			className:
				"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-transparent",
		},
		expired: {
			label: "Expired",
			className:
				"bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-transparent",
		},
		returned: {
			label: "Returned",
			className: "bg-secondary text-secondary-foreground border-transparent",
		},
		kept: {
			label: "Kept",
			className: "bg-secondary text-secondary-foreground border-transparent",
		},
	};

interface PurchaseCardProps {
	purchase: Purchase;
	onEdit: (purchase: Purchase) => void;
	onDelete: (purchase: Purchase) => void;
}

export function PurchaseCard({
	purchase,
	onEdit,
	onDelete,
}: PurchaseCardProps) {
	const { updateStatus } = usePurchaseContext();
	const status = statusConfig[purchase.returnStatus];
	const canChangeStatus =
		purchase.returnStatus === "open" || purchase.returnStatus === "expiring";

	return (
		<TableRow className="group transition-colors duration-150 hover:bg-muted/50">
			<TableCell className="font-medium">{purchase.itemName}</TableCell>
			<TableCell>{purchase.retailerDisplay}</TableCell>
			<TableCell>{formatDate(purchase.purchaseDate)}</TableCell>
			<TableCell>{formatDate(purchase.returnDeadline)}</TableCell>
			<TableCell>
				<span
					className={cn(
						"text-sm",
						purchase.daysUntilReturn <= 0
							? "text-red-600 dark:text-red-400"
							: purchase.daysUntilReturn <= 7
								? "text-amber-600 dark:text-amber-400"
								: "text-muted-foreground",
					)}
				>
					{formatDaysLeft(purchase.daysUntilReturn)}
				</span>
			</TableCell>
			<TableCell>
				<Badge className={status.className}>{status.label}</Badge>
			</TableCell>
			<TableCell className="text-right">{purchase.priceDisplay}</TableCell>
			<TableCell className="w-10">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
						>
							<MoreHorizontal className="size-4" />
							<span className="sr-only">Actions</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(purchase)}>
							<Pencil className="size-4" />
							Edit
						</DropdownMenuItem>
						{canChangeStatus && (
							<>
								<DropdownMenuItem
									onClick={() =>
										updateStatus(purchase.id, "returned").catch(console.error)
									}
								>
									<PackageCheck className="size-4" />
									Mark Returned
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() =>
										updateStatus(purchase.id, "kept").catch(console.error)
									}
								>
									<PackageMinus className="size-4" />
									Mark Kept
								</DropdownMenuItem>
							</>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={() => onDelete(purchase)}
						>
							<Trash2 className="size-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</TableCell>
		</TableRow>
	);
}
