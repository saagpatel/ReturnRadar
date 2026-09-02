import { CalendarClock, FileSearch, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	listCapturedDeadlines,
	type CapturedDeadline,
} from "@/lib/receipt-capture/persistence";
import type { DeadlineType } from "@/lib/receipt-capture/types";

const TYPE_LABELS: Record<DeadlineType, string> = {
	return: "Return",
	rebate: "Rebate",
	warranty: "Warranty",
	price_adjustment: "Price adjustment",
};

export function CapturedDeadlineList({
	onOpenCapture,
	refreshToken,
}: {
	onOpenCapture: () => void;
	refreshToken: number;
}) {
	const [deadlines, setDeadlines] = useState<CapturedDeadline[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		listCapturedDeadlines()
			.then((result) => {
				setDeadlines(result);
				setError(null);
			})
			.catch((caught: unknown) => {
				setError(caught instanceof Error ? caught.message : String(caught));
			})
			.finally(() => setLoading(false));
	}, [refreshToken]);

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="text-3xl font-extrabold tracking-tight">Captured deadlines</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Dates you explicitly reviewed from a selected receipt or policy.
					</p>
				</div>
				<Button size="sm" onClick={onOpenCapture}>
					<Plus className="size-4" aria-hidden="true" /> Capture document
				</Button>
			</div>

			{error && (
				<div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
					Could not load captured deadlines: {error}
				</div>
			)}

			{loading ? (
				<div className="rounded-lg border p-8 text-center text-sm text-muted-foreground" aria-live="polite">
					Loading captured deadlines…
				</div>
			) : deadlines.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 py-24 text-center">
					<FileSearch className="size-14 text-muted-foreground/40" aria-hidden="true" />
					<div>
						<p className="font-medium">No confirmed captures yet</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Candidates only appear here after explicit review and confirmation.
						</p>
					</div>
					<Button variant="outline" size="sm" onClick={onOpenCapture}>
						Capture a document
					</Button>
				</div>
			) : (
				<div className="grid gap-3">
					{deadlines.map((deadline) => (
						<article key={deadline.id} className="flex flex-wrap items-center gap-4 rounded-xl border bg-white p-4 text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-100">
							<div className="grid size-10 place-items-center rounded-lg bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
								<CalendarClock className="size-5" aria-hidden="true" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<h3 className="truncate font-semibold">{deadline.title}</h3>
									<Badge variant="secondary">{TYPE_LABELS[deadline.type]}</Badge>
								</div>
								<p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
									{deadline.merchant || "Merchant not recorded"} · Provenance {deadline.sourceLabel}
								</p>
							</div>
							<div className="text-right">
								<p className="font-mono text-sm font-semibold">{deadline.dueDate}</p>
								<p className="text-xs text-zinc-600 dark:text-zinc-400">Confirmed by you</p>
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}
