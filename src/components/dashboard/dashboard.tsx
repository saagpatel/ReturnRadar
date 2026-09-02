import {
	AlertTriangle,
	DollarSign,
	Receipt,
	Shield,
	ShoppingBag,
} from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { usePurchaseContext } from "@/hooks/use-purchases";
import { useRebateContext } from "@/hooks/use-rebates";
import { useWarrantyContext } from "@/hooks/use-warranties";
import { centsToDollars, formatDate, formatDaysLeft } from "@/lib/format";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { StatCard } from "./stat-card";

export function Dashboard() {
	const { purchases, loading: purchasesLoading } = usePurchaseContext();
	const { rebates, loading: rebatesLoading } = useRebateContext();
	const { warranties, loading: warrantiesLoading } = useWarrantyContext();

	const loading = purchasesLoading || rebatesLoading || warrantiesLoading;

	const stats = useMemo(() => {
		const openPurchases = purchases.filter(
			(p) => p.returnStatus === "open" || p.returnStatus === "expiring",
		);
		const expiringThisWeek = openPurchases.filter(
			(p) => p.daysUntilReturn >= 0 && p.daysUntilReturn <= 7,
		);
		const pendingRebates = rebates.filter(
			(r) =>
				r.submissionStatus === "pending" || r.submissionStatus === "submitted",
		);
		const activeWarranties = warranties.filter(
			(w) => w.warrantyStatus === "active" || w.warrantyStatus === "expiring",
		);
		const purchaseRecoverable = openPurchases.reduce(
			(sum, p) => sum + p.priceCents,
			0,
		);
		const rebateRecoverable = pendingRebates.reduce(
			(sum, r) => sum + r.rebateAmountCents,
			0,
		);

		return {
			expiringThisWeek,
			openReturnCount: openPurchases.length,
			pendingRebateCount: pendingRebates.length,
			activeWarrantyCount: activeWarranties.length,
			totalRecoverable: centsToDollars(purchaseRecoverable + rebateRecoverable),
		};
	}, [purchases, rebates, warranties]);

	if (loading) {
		return <DashboardSkeleton />;
	}

	return (
		<div className="space-y-8">
			<h2 className="text-3xl font-extrabold tracking-tight">Dashboard</h2>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<StatCard
					title="Expiring This Week"
					value={stats.expiringThisWeek.length}
					description={
						stats.expiringThisWeek.length > 0
							? `${stats.expiringThisWeek.length} return${stats.expiringThisWeek.length === 1 ? "" : "s"} due soon`
							: "All clear"
					}
					icon={AlertTriangle}
					variant={stats.expiringThisWeek.length > 0 ? "warning" : "default"}
				/>
				<StatCard
					title="Open Returns"
					value={stats.openReturnCount}
					description="Active return windows"
					icon={ShoppingBag}
				/>
				<StatCard
					title="Pending Rebates"
					value={stats.pendingRebateCount}
					description="Awaiting submission"
					icon={Receipt}
				/>
				<StatCard
					title="Active Warranties"
					value={stats.activeWarrantyCount}
					description="Under coverage"
					icon={Shield}
				/>
				<StatCard
					title="Recoverable"
					value={stats.totalRecoverable}
					description="From returns + rebates"
					icon={DollarSign}
				/>
			</div>

			{stats.expiringThisWeek.length > 0 && (
				<div className="space-y-3">
					<h3 className="text-xl font-semibold">Expiring Soon</h3>
					<div className="space-y-2">
						{stats.expiringThisWeek.map((p) => (
							<div
								key={p.id}
								className="flex items-center justify-between rounded-lg border px-5 py-4 transition-colors duration-150 hover:border-amber-200 dark:hover:border-amber-800"
							>
								<div className="flex flex-col gap-0.5">
									<span className="text-sm font-medium">{p.itemName}</span>
									<span className="text-xs text-muted-foreground">
										{p.retailerDisplay} · Return by{" "}
										{formatDate(p.returnDeadline)}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<span className="text-sm font-medium">{p.priceDisplay}</span>
									<Badge
										className={
											p.daysUntilReturn <= 1
												? "bg-red-100 text-red-700 border-transparent dark:bg-red-900/30 dark:text-red-400"
												: "bg-amber-100 text-amber-700 border-transparent dark:bg-amber-900/30 dark:text-amber-400"
										}
									>
										{formatDaysLeft(p.daysUntilReturn)}
									</Badge>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{purchases.length === 0 && rebates.length === 0 && (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/30 py-32 text-center text-muted-foreground">
					<p className="text-lg font-medium">
						No purchases or rebates tracked yet.
					</p>
					<p className="text-sm">
						Press ⌘N to add your first purchase and start tracking return
						deadlines.
					</p>
				</div>
			)}
		</div>
	);
}
