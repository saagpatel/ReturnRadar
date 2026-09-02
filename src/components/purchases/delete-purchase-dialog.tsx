import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePurchaseContext } from "@/hooks/use-purchases";
import { useRebateContext } from "@/hooks/use-rebates";
import type { Purchase } from "@/types";

interface DeletePurchaseDialogProps {
	purchase: Purchase | null;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}

export function DeletePurchaseDialog({
	purchase,
	onOpenChange,
	onDeleted,
}: DeletePurchaseDialogProps) {
	const { deletePurchase } = usePurchaseContext();
	const { getByPurchase, refetch: refetchRebates } = useRebateContext();

	const linkedRebates = purchase ? getByPurchase(purchase.id) : [];
	const rebateCount = linkedRebates.length;

	async function handleConfirm() {
		if (!purchase) return;
		try {
			await deletePurchase(purchase.id);
			await refetchRebates(); // CASCADE may have deleted linked rebates
			onDeleted();
		} catch (err: unknown) {
			console.error("Failed to delete purchase:", err);
		}
		onOpenChange(false);
	}

	return (
		<AlertDialog open={!!purchase} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Purchase</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete{" "}
						<strong>{purchase?.itemName}</strong>
						{purchase?.retailerDisplay
							? ` from ${purchase.retailerDisplay}`
							: ""}
						?
						{rebateCount > 0 && (
							<>
								{" "}
								This will also delete{" "}
								<strong>
									{rebateCount} linked rebate
									{rebateCount > 1 ? "s" : ""}
								</strong>
								.
							</>
						)}
						<br />
						<br />
						This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirm}
						className="bg-destructive text-white hover:bg-destructive/90"
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
