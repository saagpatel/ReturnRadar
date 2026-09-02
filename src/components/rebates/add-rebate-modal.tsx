import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePurchaseContext } from "@/hooks/use-purchases";
import { useRebateContext } from "@/hooks/use-rebates";

interface AddRebateModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}

export function AddRebateModal({
	open,
	onOpenChange,
	onSaved,
}: AddRebateModalProps) {
	const { addRebate } = useRebateContext();
	const { purchases } = usePurchaseContext();

	const [purchaseId, setPurchaseId] = useState<string>("");
	const [amountDollars, setAmountDollars] = useState("");
	const [deadline, setDeadline] = useState("");
	const [saving, setSaving] = useState(false);

	// Only show open/expiring purchases as linkable targets
	const linkablePurchases = purchases.filter(
		(p) => p.returnStatus === "open" || p.returnStatus === "expiring",
	);

	function resetForm() {
		setPurchaseId("");
		setAmountDollars("");
		setDeadline("");
	}

	async function handleSave() {
		if (!purchaseId) return;
		const amount = parseFloat(amountDollars.replace(/^\$/, ""));
		if (Number.isNaN(amount) || amount <= 0) return;
		if (!deadline) return;

		setSaving(true);
		try {
			await addRebate({
				purchaseId: Number(purchaseId),
				rebateAmountDollars: amountDollars.replace(/^\$/, ""),
				submissionDeadline: deadline,
			});
			resetForm();
			onOpenChange(false);
			onSaved();
		} catch (err: unknown) {
			console.error("Failed to save rebate:", err);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) resetForm();
				onOpenChange(v);
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Rebate</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-2">
					<div className="grid gap-2">
						<Label>Linked Purchase</Label>
						<Select value={purchaseId} onValueChange={setPurchaseId}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select a purchase" />
							</SelectTrigger>
							<SelectContent>
								{linkablePurchases.map((p) => (
									<SelectItem key={p.id} value={String(p.id)}>
										{p.itemName}
										<span className="ml-2 text-muted-foreground">
											{p.retailerDisplay}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="rebate-amount">Rebate Amount</Label>
							<Input
								id="rebate-amount"
								placeholder="0.00"
								value={amountDollars}
								onChange={(e) => setAmountDollars(e.target.value)}
								autoFocus
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="rebate-deadline">Submission Deadline</Label>
							<Input
								id="rebate-deadline"
								type="date"
								value={deadline}
								onChange={(e) => setDeadline(e.target.value)}
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						disabled={saving || !purchaseId || !amountDollars || !deadline}
					>
						{saving ? "Saving..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
