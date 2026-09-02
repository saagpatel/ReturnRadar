import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { useRebateContext } from "@/hooks/use-rebates";
import { formatDate, formatDaysLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Rebate, RebateStatus } from "@/types";

const statusConfig: Record<RebateStatus, { label: string; className: string }> =
	{
		pending: {
			label: "Pending",
			className:
				"bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
		},
		submitted: {
			label: "Submitted",
			className:
				"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
		},
		received: {
			label: "Received",
			className:
				"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
		},
		expired: {
			label: "Expired",
			className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
		},
	};

const isTerminal = (status: RebateStatus) =>
	status === "received" || status === "expired";

export function RebateRow({ rebate }: { rebate: Rebate }) {
	const { updateStatus } = useRebateContext();
	const config = statusConfig[rebate.submissionStatus];

	function handleStatusChange(value: string) {
		updateStatus(rebate.id, value as RebateStatus).catch(console.error);
	}

	return (
		<TableRow className="transition-colors duration-150 hover:bg-muted/50">
			<TableCell className="font-medium">{rebate.purchaseItemName}</TableCell>
			<TableCell className="text-right">{rebate.amountDisplay}</TableCell>
			<TableCell>{formatDate(rebate.submissionDeadline)}</TableCell>
			<TableCell>
				<span
					className={cn(
						"text-sm",
						rebate.daysUntilDeadline <= 0
							? "text-red-600 dark:text-red-400"
							: rebate.daysUntilDeadline <= 7
								? "text-amber-600 dark:text-amber-400"
								: "text-muted-foreground",
					)}
				>
					{formatDaysLeft(rebate.daysUntilDeadline)}
				</span>
			</TableCell>
			<TableCell>
				{isTerminal(rebate.submissionStatus) ? (
					<span
						className={cn(
							"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
							config.className,
						)}
					>
						{config.label}
					</span>
				) : (
					<Select
						value={rebate.submissionStatus}
						onValueChange={handleStatusChange}
					>
						<SelectTrigger
							size="sm"
							className={cn("w-28 border-none", config.className)}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="pending">Pending</SelectItem>
							<SelectItem value="submitted">Submitted</SelectItem>
							<SelectItem value="received">Received</SelectItem>
						</SelectContent>
					</Select>
				)}
			</TableCell>
		</TableRow>
	);
}
