import { MoreHorizontal, Pencil, ShieldCheck, Trash2 } from "lucide-react";
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
import { useWarrantyContext } from "@/hooks/use-warranties";
import { formatDate, formatDaysLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Warranty, WarrantyStatus } from "@/types";

const statusConfig: Record<
	WarrantyStatus,
	{ label: string; className: string }
> = {
	active: {
		label: "Active",
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
	claimed: {
		label: "Claimed",
		className: "bg-secondary text-secondary-foreground border-transparent",
	},
};

const typeLabels: Record<string, string> = {
	standard: "Standard",
	extended: "Extended",
	accidental: "Accidental",
};

interface WarrantyCardProps {
	warranty: Warranty;
	onEdit: (warranty: Warranty) => void;
	onDelete: (warranty: Warranty) => void;
}

export function WarrantyCard({
	warranty,
	onEdit,
	onDelete,
}: WarrantyCardProps) {
	const { updateStatus } = useWarrantyContext();
	const status = statusConfig[warranty.warrantyStatus];
	const canClaim =
		warranty.warrantyStatus === "active" ||
		warranty.warrantyStatus === "expiring";

	return (
		<TableRow className="group transition-colors duration-150 hover:bg-muted/50">
			<TableCell className="font-medium">{warranty.itemName}</TableCell>
			<TableCell>{warranty.provider}</TableCell>
			<TableCell>{typeLabels[warranty.warrantyType]}</TableCell>
			<TableCell>{formatDate(warranty.startDate)}</TableCell>
			<TableCell>{formatDate(warranty.expiryDate)}</TableCell>
			<TableCell>
				<span
					className={cn(
						"text-sm",
						warranty.daysUntilExpiry <= 0
							? "text-red-600 dark:text-red-400"
							: warranty.daysUntilExpiry <= 7
								? "text-amber-600 dark:text-amber-400"
								: "text-muted-foreground",
					)}
				>
					{formatDaysLeft(warranty.daysUntilExpiry)}
				</span>
			</TableCell>
			<TableCell>
				<Badge className={status.className}>{status.label}</Badge>
			</TableCell>
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
						<DropdownMenuItem onClick={() => onEdit(warranty)}>
							<Pencil className="size-4" />
							Edit
						</DropdownMenuItem>
						{canClaim && (
							<DropdownMenuItem
								onClick={() =>
									updateStatus(warranty.id, "claimed").catch(console.error)
								}
							>
								<ShieldCheck className="size-4" />
								Mark Claimed
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={() => onDelete(warranty)}
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
