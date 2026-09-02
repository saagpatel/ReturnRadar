export type ReturnStatus =
	| "open"
	| "expiring"
	| "returned"
	| "kept"
	| "expired";

export type RebateStatus = "pending" | "submitted" | "received" | "expired";

export interface Retailer {
	id: number;
	name: string;
	defaultReturnDays: number;
	notes?: string;
}

export interface Purchase {
	id: number;
	itemName: string;
	retailerId?: number;
	retailerNameOverride?: string;
	retailerDisplay: string;
	purchaseDate: string;
	priceCents: number;
	priceDisplay: string;
	returnWindowDays: number;
	returnDeadline: string;
	returnStatus: ReturnStatus;
	daysUntilReturn: number;
	notes?: string;
	rebates?: Rebate[];
}

export interface Rebate {
	id: number;
	purchaseId: number;
	purchaseItemName: string;
	rebateAmountCents: number;
	amountDisplay: string;
	submissionDeadline: string;
	submissionStatus: RebateStatus;
	daysUntilDeadline: number;
	submittedAt?: string;
	receivedAt?: string;
	notes?: string;
}

export interface PurchaseFormInput {
	itemName: string;
	retailerId?: number;
	retailerNameOverride?: string;
	purchaseDate: string;
	priceDollars: string;
	returnWindowDays: number;
	notes?: string;
}

export interface RebateFormInput {
	purchaseId: number;
	rebateAmountDollars: string;
	submissionDeadline: string;
	notes?: string;
}

export interface DashboardSummary {
	expiringThisWeek: Purchase[];
	pendingRebates: Rebate[];
	totalRecoverableCents: number;
	openReturnCount: number;
}

export type ThemePreference = "light" | "dark" | "system";

export interface AppSettings {
	defaultReturnDays: number;
	notify7day: boolean;
	notify1day: boolean;
	notificationPermissionRequested: boolean;
	theme: ThemePreference;
}

export type WarrantyType = "standard" | "extended" | "accidental";
export type WarrantyStatus = "active" | "expiring" | "expired" | "claimed";

export interface Warranty {
	id: number;
	purchaseId?: number;
	purchaseItemName?: string;
	itemName: string;
	provider: string;
	warrantyType: WarrantyType;
	startDate: string;
	expiryDate: string;
	warrantyStatus: WarrantyStatus;
	daysUntilExpiry: number;
	coverageDetails?: string;
	notes?: string;
}

export interface WarrantyFormInput {
	purchaseId?: number;
	itemName: string;
	provider: string;
	warrantyType: WarrantyType;
	startDate: string;
	expiryDate: string;
	coverageDetails?: string;
	notes?: string;
}

export type ReceiptConfidence = "high" | "medium" | "low";

export interface ParsedReceiptItem {
	itemName: string;
	priceDollars: string;
	confidence: ReceiptConfidence;
}

export interface ParsedReceipt {
	retailerName: string;
	retailerConfidence: ReceiptConfidence;
	purchaseDate: string;
	dateConfidence: ReceiptConfidence;
	items: ParsedReceiptItem[];
}
