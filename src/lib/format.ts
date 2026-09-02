import { format, parseISO } from "date-fns";

/**
 * Convert integer cents to display string: "$12.99"
 */
export function centsToDollars(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parse dollar string to integer cents.
 * Handles "$12.99" and "12.99" (strips leading $).
 */
export function dollarsToCents(dollars: string): number {
	const cleaned = dollars.replace(/^\$/, "").trim();
	return Math.round(parseFloat(cleaned) * 100);
}

/**
 * Format ISO date string to human-readable: "Jan 15, 2024"
 */
export function formatDate(isoDate: string): string {
	return format(parseISO(isoDate), "MMM d, yyyy");
}

/**
 * Format days-until as human-readable text.
 */
export function formatDaysLeft(days: number): string {
	if (days === 0) return "Today";
	if (days === 1) return "1 day";
	if (days > 1) return `${days} days`;
	if (days === -1) return "1 day ago";
	return `${Math.abs(days)} days ago`;
}
