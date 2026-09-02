import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	FileUp,
	Loader2,
	LockKeyhole,
	Plus,
	RotateCcw,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import {
	extractSelectedDocument,
	SUPPORTED_DOCUMENT_TYPES,
} from "@/lib/receipt-capture/document";
import {
	deriveDeadlineDateForPolicies,
	extractReceiptCapture,
} from "@/lib/receipt-capture/extract";
import {
	confirmDeadlineCapture,
	type ConfirmedDeadlineDraft,
	MAX_CONFIRMED_DEADLINES,
	MAX_DEADLINE_TITLE_CHARACTERS,
	MAX_MERCHANT_CHARACTERS,
} from "@/lib/receipt-capture/persistence";
import type {
	DeadlineType,
	ExtractionIssue,
	ReceiptCaptureResult,
	ReceiptConfidence,
} from "@/lib/receipt-capture/types";

type ModalStage = "select" | "processing" | "review" | "saving";

interface ReviewDeadline extends ConfirmedDeadlineDraft {
	selected: boolean;
	requiresResolution: boolean;
	ambiguityResolved: boolean;
	issues: ExtractionIssue[];
}

interface ImportReceiptModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCaptured: () => void;
}

const DEADLINE_LABELS: Record<DeadlineType, string> = {
	return: "Return",
	rebate: "Rebate",
	warranty: "Warranty",
	price_adjustment: "Price adjustment",
};

function ConfidenceBadge({ level }: { level: ReceiptConfidence }) {
	const className =
		level === "high"
			? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
			: level === "medium"
				? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
				: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
	return (
		<Badge variant="outline" className={className}>
			{level} confidence
		</Badge>
	);
}

function titleFor(type: DeadlineType, itemName: string | null, merchant: string | null) {
	return `${itemName || merchant || "Purchase"} — ${DEADLINE_LABELS[type]}`;
}

function deadlineTitleIsValid(title: string): boolean {
	const length = Array.from(title.trim()).length;
	return length > 0 && length <= MAX_DEADLINE_TITLE_CHARACTERS;
}

function merchantIsValid(value: string): boolean {
	return Array.from(value.trim()).length <= MAX_MERCHANT_CHARACTERS;
}

function isIsoCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

export function ImportReceiptModal({
	open,
	onOpenChange,
	onCaptured,
}: ImportReceiptModalProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const operationGenerationRef = useRef(0);
	const [stage, setStage] = useState<ModalStage>("select");
	const [error, setError] = useState<string | null>(null);
	const [selectedName, setSelectedName] = useState("");
	const [extractionMs, setExtractionMs] = useState<number | null>(null);
	const [capture, setCapture] = useState<ReceiptCaptureResult | null>(null);
	const [source, setSource] = useState<{
		fingerprint: string;
		kind: "image" | "pdf";
		extractionToken: string;
	} | null>(null);
	const [merchant, setMerchant] = useState("");
	const [transactionDate, setTransactionDate] = useState("");
	const [deadlines, setDeadlines] = useState<ReviewDeadline[]>([]);
	const [globalCorrections, setGlobalCorrections] = useState<string[]>([]);
	const [receiptFactsResolved, setReceiptFactsResolved] = useState(false);
	const [confirmationFailed, setConfirmationFailed] = useState(false);

	function resetAll() {
		operationGenerationRef.current += 1;
		setStage("select");
		setError(null);
		setSelectedName("");
		setExtractionMs(null);
		setCapture(null);
		setSource(null);
		setMerchant("");
		setTransactionDate("");
		setDeadlines([]);
		setGlobalCorrections([]);
		setReceiptFactsResolved(false);
		setConfirmationFailed(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	useEffect(() => {
		if (!open) resetAll();
	}, [open]);

	async function processFile(file: File) {
		const extractionGeneration = operationGenerationRef.current + 1;
		operationGenerationRef.current = extractionGeneration;
		setStage("processing");
		setError(null);
		setConfirmationFailed(false);
		setSelectedName(file.name);
		try {
			const document = await extractSelectedDocument(file);
			if (extractionGeneration !== operationGenerationRef.current) return;
			const result = extractReceiptCapture(document.extraction.lines, {
				// The host locale is not evidence of the selected document's locale.
				// Ambiguous numeric dates remain unresolved until the user corrects them.
				sourceFingerprint: document.fingerprint,
				sourceKind: document.selected.kind,
				pageCount: document.extraction.pageCount,
			});
			setCapture(result);
			setExtractionMs(document.extraction.processingMs);
			setSource({
				fingerprint: document.fingerprint,
				kind: document.selected.kind,
				extractionToken: document.extractionToken,
			});
			setMerchant(result.receiptFacts.merchant.value ?? "");
			setTransactionDate(result.receiptFacts.transactionDate.value ?? "");
			setReceiptFactsResolved(false);
			setDeadlines(
				result.candidates.map((candidate) => ({
					candidateId: candidate.id,
					type: candidate.type,
					title: titleFor(
						candidate.type,
						candidate.itemName,
						result.receiptFacts.merchant.value,
					),
					dueDate: candidate.candidateDate ?? "",
					reviewed: false,
					evidence: candidate.evidence,
					correctedFields: [],
					selected: candidate.candidateDate !== null,
					requiresResolution: candidate.state === "needs_correction",
					ambiguityResolved: candidate.state !== "needs_correction",
					issues: candidate.issues,
				})),
			);
			setStage("review");
		} catch (caught: unknown) {
			if (extractionGeneration !== operationGenerationRef.current) return;
			setError(caught instanceof Error ? caught.message : String(caught));
			if (fileInputRef.current) fileInputRef.current.value = "";
			setStage("select");
		}
	}

	function updateDeadline(
		index: number,
		updates: Partial<ReviewDeadline>,
		correctedField?: string,
	) {
		setDeadlines((current) =>
			current.map((deadline, deadlineIndex) =>
				deadlineIndex === index
					? {
							...deadline,
							...updates,
							reviewed:
								updates.reviewed ?? (correctedField ? false : deadline.reviewed),
							correctedFields: correctedField
								? [...new Set([...deadline.correctedFields, correctedField])]
								: deadline.correctedFields,
						}
					: deadline,
			),
		);
	}

	function addManualDeadline() {
		setDeadlines((current) => {
			if (
				current.filter((deadline) => deadline.selected).length >=
				MAX_CONFIRMED_DEADLINES
			) {
				return current;
			}
			return [
				...current,
				{
				candidateId: `manual-${current.length + 1}`,
				type: "return",
				title: titleFor("return", null, merchant || null),
				dueDate: "",
				reviewed: false,
				evidence: [],
				correctedFields: ["manual_candidate"],
				selected: true,
				requiresResolution: false,
				ambiguityResolved: true,
				issues: [],
				},
			];
		});
	}

	const selectedDeadlines = deadlines.filter((deadline) => deadline.selected);
	const transactionDateIsValid =
		transactionDate.length === 0 || isIsoCalendarDate(transactionDate);
	const receiptFactIssues = useMemo(() => {
		const seen = new Set<string>();
		return (capture?.issues ?? []).filter((entry) => {
			const isReceiptFact =
				entry.field === "merchant" ||
				entry.field === "transactionDate" ||
				entry.field === "items" ||
				entry.field.startsWith("items.");
			const key = `${entry.code}:${entry.field}`;
			if (!isReceiptFact || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [capture]);
	const receiptFactsRequireResolution = receiptFactIssues.some((entry) =>
		["missing", "conflicting", "locale_ambiguous", "ocr_low_confidence"].includes(
			entry.code,
		),
	);
	const canConfirm =
		selectedDeadlines.length > 0 &&
		selectedDeadlines.length <= MAX_CONFIRMED_DEADLINES &&
		merchantIsValid(merchant) &&
		transactionDateIsValid &&
		(!receiptFactsRequireResolution || receiptFactsResolved) &&
		selectedDeadlines.every(
			(deadline) =>
				deadline.ambiguityResolved &&
				deadline.reviewed &&
				isIsoCalendarDate(deadline.dueDate) &&
				deadlineTitleIsValid(deadline.title),
		);
	const uniqueIssues = useMemo(() => {
		const seen = new Set<string>();
		return (capture?.issues ?? []).filter((entry) => {
			const key = `${entry.code}:${entry.field}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [capture]);

	async function handleConfirm() {
		if (!source || !canConfirm) return;
		const confirmationGeneration = operationGenerationRef.current;
		setStage("saving");
		setError(null);
		setConfirmationFailed(false);
		try {
			await confirmDeadlineCapture({
				confirmationIntent: "confirm_and_create",
				source,
				merchant: merchant.trim() || null,
				transactionDate: transactionDate || null,
				deadlines: selectedDeadlines.map((deadline) => ({
					...deadline,
					correctedFields: [
						...new Set([...deadline.correctedFields, ...globalCorrections]),
					],
				})),
			});
			if (confirmationGeneration !== operationGenerationRef.current) return;
			resetAll();
			onOpenChange(false);
			onCaptured();
		} catch (caught: unknown) {
			if (confirmationGeneration !== operationGenerationRef.current) return;
			setError(caught instanceof Error ? caught.message : String(caught));
			setConfirmationFailed(true);
			setStage("review");
		}
	}

	function correctReceiptField(fieldName: string, value: string) {
		setReceiptFactsResolved(false);
		if (fieldName === "merchant") {
			setMerchant(value);
		} else {
			setTransactionDate(value);
		}
		setGlobalCorrections((current) => [...new Set([...current, fieldName])]);
		setDeadlines((current) =>
			current.map((deadline) => ({
				...deadline,
				dueDate:
					fieldName === "transaction_date" && !deadline.candidateId.startsWith("manual-")
						? isIsoCalendarDate(value)
							? deriveDeadlineDateForPolicies(
									deadline.type,
									capture?.policyInterpretations ?? [],
									value,
								) ?? ""
							: ""
						: deadline.dueDate,
				reviewed: false,
			})),
		);
	}

	function resolveReceiptFactWarnings(checked: boolean) {
		setReceiptFactsResolved(checked);
		setGlobalCorrections((current) =>
			checked
				? [...new Set([...current, "receipt_facts_resolution"])]
				: current.filter((field) => field !== "receipt_facts_resolution"),
		);
		setDeadlines((current) =>
			current.map((deadline) => ({ ...deadline, reviewed: false })),
		);
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) resetAll();
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="max-h-[88vh] overflow-hidden p-0 text-foreground sm:max-w-3xl">
				<DialogHeader className="border-b px-6 py-5">
					<div className="flex items-center gap-2 text-primary">
						<ShieldCheck className="size-5" aria-hidden="true" />
						<span className="text-xs font-semibold tracking-wide uppercase">
							On-device capture
						</span>
					</div>
					<DialogTitle className="text-xl">
						{stage === "select" && "Capture receipt deadlines"}
						{stage === "processing" && "Reading selected document"}
						{stage === "review" && "Review every deadline"}
						{stage === "saving" && "Creating confirmed deadlines"}
					</DialogTitle>
					<DialogDescription>
						Extraction is assistive. Nothing is created until you review each selected
						date and press the final confirmation button.
					</DialogDescription>
				</DialogHeader>

				<div className="overflow-y-auto px-6 py-5">
					{stage === "select" && (
						<div className="space-y-4">
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-muted/30 px-6 py-14 text-center transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								<FileUp className="size-10 text-primary" aria-hidden="true" />
								<span className="font-semibold">Choose one receipt or policy document</span>
								<span className="max-w-md text-sm text-muted-foreground">
									PNG, JPEG, WebP, or PDF up to 12 MB. ReturnRadar never scans
									Downloads, Photos, Mail, browsers, or cloud storage.
								</span>
							</button>
							<input
								ref={fileInputRef}
								type="file"
								accept={SUPPORTED_DOCUMENT_TYPES.join(",")}
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void processFile(file);
								}}
								className="sr-only"
								aria-label="Choose receipt or policy document"
							/>
							<div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3">
								{[
									["Local only", "No uploads or paid OCR."],
									["Evidence-linked", "Only redacted supporting spans are kept."],
									["Confirmation-gated", "Ambiguity always comes back to you."],
								].map(([title, detail]) => (
									<div key={title} className="flex gap-2">
										<LockKeyhole className="mt-0.5 size-4 text-primary" aria-hidden="true" />
										<div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div>
									</div>
								))}
							</div>
						</div>
					)}

					{(stage === "processing" || stage === "saving") && (
						<div className="flex min-h-64 flex-col items-center justify-center gap-4" aria-live="polite">
							<Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
							<div className="text-center">
								<p className="font-medium">{stage === "processing" ? "Extracting text locally…" : "Saving only confirmed fields…"}</p>
								{selectedName && <p className="mt-1 text-sm text-muted-foreground">{selectedName}</p>}
							</div>
						</div>
					)}

					{stage === "review" && capture && (
						<div className="space-y-6">
							<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-3">
								<div><p className="text-sm font-medium">{selectedName}</p><p className="text-xs text-muted-foreground">Raw content is discarded after review.</p></div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="outline">{capture.source.pageCount} page{capture.source.pageCount === 1 ? "" : "s"}</Badge>
									{extractionMs !== null ? <Badge variant="outline">Local extraction {extractionMs} ms</Badge> : null}
								</div>
							</div>

							{uniqueIssues.length > 0 && (
								<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="status">
									<div className="flex gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><div><p className="text-sm font-semibold">Review needed</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs">{uniqueIssues.map((entry) => <li key={`${entry.code}-${entry.field}`}>{entry.message}</li>)}</ul></div></div>
								</div>
							)}

							<section aria-labelledby="receipt-facts-heading" className="space-y-3">
								<div className="flex items-center justify-between"><h3 id="receipt-facts-heading" className="font-semibold">Receipt facts</h3><span className="text-xs text-muted-foreground">What the document says</span></div>
								<div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
									<div className="grid gap-2"><div className="flex items-center justify-between gap-2"><Label htmlFor="capture-merchant">Merchant</Label><ConfidenceBadge level={capture.receiptFacts.merchant.confidenceLabel} /></div><Input id="capture-merchant" value={merchant} maxLength={MAX_MERCHANT_CHARACTERS} onChange={(event) => correctReceiptField("merchant", event.target.value)} aria-describedby="capture-merchant-limit" /><p id="capture-merchant-limit" className="text-xs text-muted-foreground">{MAX_MERCHANT_CHARACTERS} characters maximum.</p>{!merchantIsValid(merchant) ? <p className="text-xs text-destructive" role="alert">Shorten the merchant before confirmation.</p> : null}</div>
									<div className="grid gap-2"><div className="flex items-center justify-between gap-2"><Label htmlFor="capture-date">Transaction date</Label><ConfidenceBadge level={capture.receiptFacts.transactionDate.confidenceLabel} /></div><Input id="capture-date" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} value={transactionDate} onInput={(event) => correctReceiptField("transaction_date", event.currentTarget.value)} onBlur={(event) => { if (event.currentTarget.value !== transactionDate) correctReceiptField("transaction_date", event.currentTarget.value); }} aria-describedby="capture-date-format" aria-invalid={!transactionDateIsValid} /><p id="capture-date-format" className="text-xs text-muted-foreground">YYYY-MM-DD. Empty means unresolved.</p>{!transactionDateIsValid ? <p className="text-xs text-destructive" role="alert">Enter a valid date as YYYY-MM-DD.</p> : null}</div>
								</div>
								{capture.receiptFacts.items.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Extracted item candidates">{capture.receiptFacts.items.map((item, index) => <Badge key={`${item.name.value}-${index}`} variant="secondary">{item.name.value || "Unknown item"} · ${item.priceDollars.value || "—"}</Badge>)}</div>}
								{receiptFactsRequireResolution && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><div role="status" aria-live="polite" aria-atomic="true"><p className="font-medium">Resolve receipt fact warnings</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs">{receiptFactIssues.map((entry) => <li key={`${entry.code}-${entry.field}`}>{entry.message}</li>)}</ul></div><div className="mt-3 flex items-center gap-2"><Checkbox id="receipt-facts-resolved" checked={receiptFactsResolved} onCheckedChange={(checked) => resolveReceiptFactWarnings(checked === true)} /><Label htmlFor="receipt-facts-resolved" className="text-sm font-medium">I verified or corrected every receipt fact warning above</Label></div></div>}
							</section>

							<section aria-labelledby="policy-heading" className="space-y-3">
								<div className="flex items-center justify-between gap-3"><div><h3 id="policy-heading" className="font-semibold">Policy interpretation</h3><p className="text-xs text-muted-foreground">Assistive extraction only—not legal advice. Confirm up to {MAX_CONFIRMED_DEADLINES} deadlines at a time.</p></div><Button type="button" variant="outline" size="sm" onClick={addManualDeadline} disabled={selectedDeadlines.length >= MAX_CONFIRMED_DEADLINES}><Plus className="size-4" aria-hidden="true" /> Add manual deadline</Button></div>
								{capture.policyInterpretations.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No supported policy was found. ReturnRadar will not use a retailer default as evidence; add a manual deadline only if you can verify it.</p> : <div className="space-y-2">{capture.policyInterpretations.map((policy, index) => <div key={`${policy.type}-${index}`} className="rounded-lg border px-4 py-3"><div className="flex items-center justify-between gap-3"><Badge variant="secondary">{DEADLINE_LABELS[policy.type]}</Badge><ConfidenceBadge level={policy.confidenceLabel} /></div><p className="mt-2 text-sm">{policy.description}</p></div>)}</div>}
							</section>

							<section aria-labelledby="candidate-heading" className="space-y-3">
								<div><h3 id="candidate-heading" className="font-semibold">Candidate deadlines</h3><p className="text-xs text-muted-foreground">Correct fields first, then check “Reviewed” on every deadline you want to create.</p></div>
								{deadlines.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No deadline was created from ambiguous evidence.</p>}
								<div className="space-y-3">{deadlines.map((deadline, index) => (
									<article key={deadline.candidateId} className="rounded-xl border bg-card p-4">
										<div className="flex items-start gap-3"><Checkbox id={`select-deadline-${index}`} checked={deadline.selected} disabled={!deadline.selected && selectedDeadlines.length >= MAX_CONFIRMED_DEADLINES} onCheckedChange={(checked) => updateDeadline(index, { selected: checked === true, reviewed: false })} aria-label={`Select deadline ${index + 1}: ${deadline.title || DEADLINE_LABELS[deadline.type]}`} /><div className="grid flex-1 gap-4 sm:grid-cols-[10rem_1fr_10rem]">
											<div className="grid gap-2"><Label htmlFor={`deadline-type-${index}`}>Type</Label><Select value={deadline.type} onValueChange={(value) => updateDeadline(index, { type: value as DeadlineType }, "deadline_type")} disabled={!deadline.selected}><SelectTrigger id={`deadline-type-${index}`} aria-label={`Type for deadline ${index + 1}: ${deadline.title || DEADLINE_LABELS[deadline.type]}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(DEADLINE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
											<div className="grid gap-2"><Label htmlFor={`deadline-title-${index}`}>Title</Label><Input id={`deadline-title-${index}`} value={deadline.title} maxLength={MAX_DEADLINE_TITLE_CHARACTERS} disabled={!deadline.selected} onChange={(event) => updateDeadline(index, { title: event.target.value }, "title")} aria-label={`Title for deadline ${index + 1}`} aria-describedby={`deadline-title-limit-${index}`} /><p id={`deadline-title-limit-${index}`} className="text-xs text-muted-foreground">{MAX_DEADLINE_TITLE_CHARACTERS} characters maximum.</p>{deadline.title.trim() && !deadlineTitleIsValid(deadline.title) ? <p className="text-xs text-destructive" role="alert">Shorten this title before review.</p> : null}</div>
											<div className="grid gap-2"><Label htmlFor={`deadline-date-${index}`}>Due date</Label><Input id={`deadline-date-${index}`} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} value={deadline.dueDate} disabled={!deadline.selected} onInput={(event) => updateDeadline(index, { dueDate: event.currentTarget.value }, "due_date")} onBlur={(event) => { if (event.currentTarget.value !== deadline.dueDate) updateDeadline(index, { dueDate: event.currentTarget.value }, "due_date"); }} aria-label={`Due date for deadline ${index + 1}: ${deadline.title || DEADLINE_LABELS[deadline.type]}`} aria-invalid={deadline.selected && deadline.dueDate.length > 0 && !isIsoCalendarDate(deadline.dueDate)} />{deadline.selected && deadline.dueDate.length > 0 && !isIsoCalendarDate(deadline.dueDate) ? <p className="text-xs text-destructive" role="alert">Enter a valid date as YYYY-MM-DD.</p> : null}</div>
										</div></div>
									{deadline.requiresResolution && <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><div role="status" aria-live="polite" aria-atomic="true"><p className="font-medium">Resolve extraction warnings</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs">{deadline.issues.map((entry) => <li key={`${entry.code}-${entry.field}`}>{entry.message}</li>)}</ul></div><div className="mt-3 flex items-center gap-2"><Checkbox id={`resolved-${index}`} checked={deadline.ambiguityResolved} disabled={!deadline.selected} onCheckedChange={(checked) => updateDeadline(index, { ambiguityResolved: checked === true, reviewed: false }, checked === true ? "ambiguity_resolution" : undefined)} aria-label={`Resolve every warning for deadline ${index + 1}: ${deadline.title || DEADLINE_LABELS[deadline.type]}`} /><Label htmlFor={`resolved-${index}`} className="text-sm font-medium">I verified and resolved every extraction warning above</Label></div></div>}
									<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">{deadline.evidence.length > 0 ? <details className="group text-xs text-muted-foreground"><summary className="flex cursor-pointer list-none items-center gap-1 font-medium"><ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden="true" /> Supporting evidence</summary><ul className="mt-2 max-w-xl space-y-1 pl-4">{deadline.evidence.slice(0, 4).map((span, spanIndex) => <li key={`${span.line}-${spanIndex}`}>Page {span.page ?? 1}: “{span.text}”</li>)}</ul></details> : <span className="text-xs text-muted-foreground">Manual entry · no extracted evidence</span>}<div className="flex items-center gap-2"><Checkbox id={`reviewed-${index}`} checked={deadline.reviewed} disabled={!deadline.selected || !deadline.ambiguityResolved || !deadlineTitleIsValid(deadline.title) || !isIsoCalendarDate(deadline.dueDate)} onCheckedChange={(checked) => updateDeadline(index, { reviewed: checked === true })} aria-label={`Reviewed deadline ${index + 1}: ${deadline.title || DEADLINE_LABELS[deadline.type]}`} /><Label htmlFor={`reviewed-${index}`} className="text-sm font-medium">Reviewed</Label></div></div>
									</article>
								))}</div>
							</section>
						</div>
					)}

					{error && <div className="mt-4 flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{error}</span></div>}
				</div>

				{stage === "review" && (
					<DialogFooter className="border-t bg-muted/20 px-6 py-4">
						<Button type="button" variant="outline" onClick={resetAll}><RotateCcw className="size-4" aria-hidden="true" /> Choose another</Button>
						<Button type="button" onClick={() => void handleConfirm()} disabled={!canConfirm}><CheckCircle2 className="size-4" aria-hidden="true" />{confirmationFailed ? "Retry and create" : "Confirm and create"} {selectedDeadlines.length} deadline{selectedDeadlines.length === 1 ? "" : "s"}</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
