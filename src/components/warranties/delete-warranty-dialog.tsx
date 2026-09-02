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
import { useWarrantyContext } from "@/hooks/use-warranties";
import type { Warranty } from "@/types";

interface DeleteWarrantyDialogProps {
	warranty: Warranty | null;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}

export function DeleteWarrantyDialog({
	warranty,
	onOpenChange,
	onDeleted,
}: DeleteWarrantyDialogProps) {
	const { deleteWarranty } = useWarrantyContext();

	async function handleConfirm() {
		if (!warranty) return;
		try {
			await deleteWarranty(warranty.id);
			onDeleted();
		} catch (err: unknown) {
			console.error("Failed to delete warranty:", err);
		}
		onOpenChange(false);
	}

	return (
		<AlertDialog open={!!warranty} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Warranty</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete the{" "}
						<strong>{warranty?.provider}</strong> warranty for{" "}
						<strong>{warranty?.itemName}</strong>?
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
