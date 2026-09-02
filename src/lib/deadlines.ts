import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { ReturnStatus } from "@/types";

/**
 * Calculate days until a deadline from a reference date.
 * Positive = days remaining, 0 = today, negative = past.
 */
export function daysUntil(deadline: string, today: string): number {
	return differenceInCalendarDays(parseISO(deadline), parseISO(today));
}

/**
 * Compute return status based on deadline proximity.
 * Does NOT handle 'returned' or 'kept' — those are manual overrides.
 */
export function calculateStatus(
	returnDeadline: string,
	today: string,
): ReturnStatus {
	const days = daysUntil(returnDeadline, today);
	if (days <= 0) return "expired";
	if (days <= 7) return "expiring";
	return "open";
}

/**
 * Compute the return deadline date from purchase date + window days.
 * Returns ISO date string YYYY-MM-DD.
 */
export function getReturnDeadline(
	purchaseDate: string,
	windowDays: number,
): string {
	return format(addDays(parseISO(purchaseDate), windowDays), "yyyy-MM-dd");
}
