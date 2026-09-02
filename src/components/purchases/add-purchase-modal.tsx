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
import { usePurchaseContext } from "@/hooks/use-purchases";
import { useRetailers } from "@/hooks/use-retailers";
import type { Purchase } from "@/types";

interface AddPurchaseModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
	editPurchase?: Purchase;
}

const OTHER_RETAILER_NAME = "Other";

export function AddPurchaseModal({
	open,
	onOpenChange,
	onSaved,
	editPurchase,
}: AddPurchaseModalProps) {
	const { addPurchase, updatePurchase } = usePurchaseContext();
	const { retailers } = useRetailers();

	const [itemName, setItemName] = useState("");
	const [retailerId, setRetailerId] = useState<string>("");
	const [customRetailer, setCustomRetailer] = useState("");
	const [purchaseDate, setPurchaseDate] = useState(
		format(new Date(), "yyyy-MM-dd"),
	);
	const [priceDollars, setPriceDollars] = useState("");
	const [returnWindowDays, setReturnWindowDays] = useState(30);
	const [saving, setSaving] = useState(false);

	const isEditing = !!editPurchase;
	const selectedRetailer = retailers.find((r) => r.id === Number(retailerId));
	const isOther = selectedRetailer?.name === OTHER_RETAILER_NAME;

	// Pre-populate form when editing
	useEffect(() => {
		if (open && editPurchase) {
			setItemName(editPurchase.itemName);
			setRetailerId(
				editPurchase.retailerId ? String(editPurchase.retailerId) : "",
			);
			setCustomRetailer(editPurchase.retailerNameOverride ?? "");
			setPurchaseDate(editPurchase.purchaseDate);
			setPriceDollars((editPurchase.priceCents / 100).toFixed(2));
			setReturnWindowDays(editPurchase.returnWindowDays);
		} else if (open && !editPurchase) {
			resetForm();
		}
	}, [open, editPurchase]);

	function resetForm() {
		setItemName("");
		setRetailerId("");
		setCustomRetailer("");
		setPurchaseDate(format(new Date(), "yyyy-MM-dd"));
		setPriceDollars("");
		setReturnWindowDays(30);
	}

	function handleRetailerChange(value: string) {
		setRetailerId(value);
		const retailer = retailers.find((r) => r.id === Number(value));
		if (retailer) {
			setReturnWindowDays(retailer.defaultReturnDays);
		}
	}

	async function handleSave() {
		if (!itemName.trim()) return;
		const price = parseFloat(priceDollars.replace(/^\$/, ""));
		if (Number.isNaN(price) || price < 0) return;
		if (returnWindowDays < 0) return;

		const input = {
			itemName: itemName.trim(),
			retailerId: isOther ? undefined : Number(retailerId) || undefined,
			retailerNameOverride: isOther
				? customRetailer.trim() || undefined
				: undefined,
			purchaseDate,
			priceDollars: priceDollars.replace(/^\$/, ""),
			returnWindowDays,
		};

		setSaving(true);
		try {
			if (isEditing) {
				await updatePurchase(editPurchase.id, input);
			} else {
				await addPurchase(input);
			}
			resetForm();
			onOpenChange(false);
			onSaved();
		} catch (err: unknown) {
			console.error("Failed to save purchase:", err);
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
						{isEditing ? "Edit Purchase" : "Add Purchase"}
					</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-2">
					<div className="grid gap-2">
						<Label htmlFor="item-name">Item Name</Label>
						<Input
							id="item-name"
							placeholder="What did you buy?"
							value={itemName}
							onChange={(e) => setItemName(e.target.value)}
							autoFocus
						/>
					</div>

					<div className="grid gap-2">
						<Label>Retailer</Label>
						<Select value={retailerId} onValueChange={handleRetailerChange}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select retailer" />
							</SelectTrigger>
							<SelectContent>
								{retailers.map((r) => (
									<SelectItem key={r.id} value={String(r.id)}>
										{r.name}
										{r.name !== OTHER_RETAILER_NAME && (
											<span className="ml-2 text-muted-foreground">
												{r.defaultReturnDays}d
											</span>
										)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{isOther && (
							<Input
								placeholder="Retailer name"
								value={customRetailer}
								onChange={(e) => setCustomRetailer(e.target.value)}
							/>
						)}
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="purchase-date">Purchase Date</Label>
							<Input
								id="purchase-date"
								type="date"
								value={purchaseDate}
								onChange={(e) => setPurchaseDate(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="price">Price</Label>
							<Input
								id="price"
								placeholder="0.00"
								value={priceDollars}
								onChange={(e) => setPriceDollars(e.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="return-window">Return Window (days)</Label>
						<Input
							id="return-window"
							type="number"
							min={0}
							value={returnWindowDays}
							onChange={(e) => setReturnWindowDays(Number(e.target.value))}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={saving || !itemName.trim()}>
						{saving ? "Saving..." : isEditing ? "Update" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
