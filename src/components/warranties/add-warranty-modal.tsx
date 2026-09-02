import { format } from "date-fns";
import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { usePurchaseContext } from "@/hooks/use-purchases";
import { useWarrantyContext } from "@/hooks/use-warranties";
import type { Warranty, WarrantyType } from "@/types";

interface AddWarrantyModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
	editWarranty?: Warranty;
}

export function AddWarrantyModal({
	open,
	onOpenChange,
	onSaved,
	editWarranty,
}: AddWarrantyModalProps) {
	const { addWarranty, updateWarranty } = useWarrantyContext();
	const { purchases } = usePurchaseContext();

	const [itemName, setItemName] = useState("");
	const [purchaseId, setPurchaseId] = useState<string>("");
	const [provider, setProvider] = useState("");
	const [warrantyType, setWarrantyType] = useState<WarrantyType>("standard");
	const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
	const [expiryDate, setExpiryDate] = useState("");
	const [coverageDetails, setCoverageDetails] = useState("");
	const [saving, setSaving] = useState(false);

	const isEditing = !!editWarranty;

	useEffect(() => {
		if (open && editWarranty) {
			setItemName(editWarranty.itemName);
			setPurchaseId(
				editWarranty.purchaseId ? String(editWarranty.purchaseId) : "",
			);
			setProvider(editWarranty.provider);
			setWarrantyType(editWarranty.warrantyType);
			setStartDate(editWarranty.startDate);
			setExpiryDate(editWarranty.expiryDate);
			setCoverageDetails(editWarranty.coverageDetails ?? "");
		} else if (open && !editWarranty) {
			resetForm();
		}
	}, [open, editWarranty]);

	function resetForm() {
		setItemName("");
		setPurchaseId("");
		setProvider("");
		setWarrantyType("standard");
		setStartDate(format(new Date(), "yyyy-MM-dd"));
		setExpiryDate("");
		setCoverageDetails("");
	}

	function handlePurchaseChange(value: string) {
		setPurchaseId(value);
		if (value) {
			const purchase = purchases.find((p) => p.id === Number(value));
			if (purchase && !itemName) {
				setItemName(purchase.itemName);
			}
		}
	}

	async function handleSave() {
		if (!itemName.trim() || !provider.trim() || !expiryDate) return;

		const input = {
			purchaseId: purchaseId ? Number(purchaseId) : undefined,
			itemName: itemName.trim(),
			provider: provider.trim(),
			warrantyType,
			startDate,
			expiryDate,
			coverageDetails: coverageDetails.trim() || undefined,
		};

		setSaving(true);
		try {
			if (isEditing) {
				await updateWarranty(editWarranty.id, input);
			} else {
				await addWarranty(input);
			}
			resetForm();
			onOpenChange(false);
			onSaved();
		} catch (err: unknown) {
			console.error("Failed to save warranty:", err);
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
					<DialogTitle>
						{isEditing ? "Edit Warranty" : "Add Warranty"}
					</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-2">
					<div className="grid gap-2">
						<Label htmlFor="warranty-item">Item Name</Label>
						<Input
							id="warranty-item"
							placeholder="What's covered?"
							value={itemName}
							onChange={(e) => setItemName(e.target.value)}
							autoFocus
						/>
					</div>

					<div className="grid gap-2">
						<Label>Linked Purchase (optional)</Label>
						<Select value={purchaseId} onValueChange={handlePurchaseChange}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="None" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">None</SelectItem>
								{purchases.map((p) => (
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
							<Label htmlFor="warranty-provider">Provider</Label>
							<Input
								id="warranty-provider"
								placeholder="e.g., Apple, Best Buy"
								value={provider}
								onChange={(e) => setProvider(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Type</Label>
							<Select
								value={warrantyType}
								onValueChange={(v) => setWarrantyType(v as WarrantyType)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="standard">Standard</SelectItem>
									<SelectItem value="extended">Extended</SelectItem>
									<SelectItem value="accidental">Accidental</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="warranty-start">Start Date</Label>
							<Input
								id="warranty-start"
								type="date"
								value={startDate}
								onChange={(e) => setStartDate(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="warranty-expiry">Expiry Date</Label>
							<Input
								id="warranty-expiry"
								type="date"
								value={expiryDate}
								onChange={(e) => setExpiryDate(e.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="warranty-coverage">
							Coverage Details (optional)
						</Label>
						<Textarea
							id="warranty-coverage"
							placeholder="Parts and labor, 2 years..."
							value={coverageDetails}
							onChange={(e) => setCoverageDetails(e.target.value)}
							rows={2}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						disabled={
							saving || !itemName.trim() || !provider.trim() || !expiryDate
						}
					>
						{saving ? "Saving..." : isEditing ? "Update" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
