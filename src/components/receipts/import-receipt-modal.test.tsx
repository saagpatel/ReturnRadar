import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECEIPT_CAPTURE_CORPUS } from "@/test-fixtures/receipt-capture/corpus";
import { ImportReceiptModal } from "./import-receipt-modal";

const { extractSelectedDocument, confirmDeadlineCapture } = vi.hoisted(() => ({
	extractSelectedDocument: vi.fn(),
	confirmDeadlineCapture: vi.fn(),
}));

vi.mock("@/lib/receipt-capture/document", () => ({
	SUPPORTED_DOCUMENT_TYPES: ["image/png", "application/pdf"],
	extractSelectedDocument,
}));

vi.mock("@/lib/receipt-capture/persistence", async (importOriginal) => {
	const original = await importOriginal<
		typeof import("@/lib/receipt-capture/persistence")
	>();
	return { ...original, confirmDeadlineCapture };
});

const EXTRACTION_TOKEN = "00000000-0000-4000-8000-000000000001";

function selectedDocument(merchant: string, fingerprintCharacter: string) {
	return {
		extraction: {
			schema: "DocumentTextExtractionV1",
			kind: "image",
			engine: "apple-vision",
			pageCount: 1,
			lines: [
				{ text: merchant, confidence: 0.96, page: 1 },
				{ text: "Purchase date 2026-01-01", confidence: 0.96, page: 1 },
				{ text: "Desk Clock $30.00", confidence: 0.96, page: 1 },
				{ text: "Returns within 30 days", confidence: 0.96, page: 1 },
			],
			processingMs: 8,
			rawContentRetained: false,
		},
		fingerprint: fingerprintCharacter.repeat(64),
		extractionToken: EXTRACTION_TOKEN,
		selected: { kind: "image", mimeType: "image/png" },
	} as const;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

describe("ImportReceiptModal confirmation flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const fixture = RECEIPT_CAPTURE_CORPUS.find(
			(entry) => entry.id === "warranty-one-year",
		);
		if (!fixture) throw new Error("fixture missing");
		extractSelectedDocument.mockResolvedValue({
			extraction: {
				schema: "DocumentTextExtractionV1",
				kind: "image",
				engine: "apple-vision",
				pageCount: 1,
				lines: fixture.lines,
				processingMs: 8,
				rawContentRetained: false,
			},
			fingerprint: "a".repeat(64),
			extractionToken: EXTRACTION_TOKEN,
			selected: { kind: "image", mimeType: "image/png" },
		});
		confirmDeadlineCapture.mockResolvedValue(undefined);
	});

	it("does not persist until the user reviews and presses final confirmation", async () => {
		const onOpenChange = vi.fn();
		const onCaptured = vi.fn();
		render(
			<ImportReceiptModal
				open
				onOpenChange={onOpenChange}
				onCaptured={onCaptured}
			/>,
		);
		expect(
			screen.getByRole("dialog", { name: "Capture receipt deadlines" }),
		).toHaveClass("text-foreground");

		const input = screen.getByLabelText("Choose receipt or policy document");
		fireEvent.change(input, {
			target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] },
		});

		await screen.findByText("Review every deadline");
		const transactionDate = screen.getByLabelText("Transaction date");
		const dueDate = screen.getByLabelText(/^Due date for deadline/);
		expect(dueDate).toHaveValue("2027-02-28");
		fireEvent.change(transactionDate, { target: { value: "2026-03-01" } });
		expect(dueDate).toHaveValue("2027-03-01");
		const finalButton = screen.getByRole("button", {
			name: /Confirm and create 1 deadline/,
		});
		expect(finalButton).toBeDisabled();
		expect(confirmDeadlineCapture).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("checkbox", { name: /^Reviewed deadline/ }));
		expect(finalButton).toBeEnabled();
		fireEvent.click(finalButton);

		await waitFor(() => expect(confirmDeadlineCapture).toHaveBeenCalledOnce());
		expect(confirmDeadlineCapture).toHaveBeenCalledWith(
			expect.objectContaining({
				confirmationIntent: "confirm_and_create",
				deadlines: [
					expect.objectContaining({
						type: "warranty",
						dueDate: "2027-03-01",
						reviewed: true,
					}),
				],
			}),
		);
		await waitFor(() => expect(onCaptured).toHaveBeenCalledOnce());
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("requires explicit resolution before a needs-correction candidate can be reviewed", async () => {
		const fixture = RECEIPT_CAPTURE_CORPUS.find(
			(entry) => entry.id === "return-exclusion",
		);
		if (!fixture) throw new Error("fixture missing");
		extractSelectedDocument.mockResolvedValueOnce({
			extraction: {
				schema: "DocumentTextExtractionV1",
				kind: "image",
				engine: "apple-vision",
				pageCount: 1,
				lines: fixture.lines,
				processingMs: 8,
				rawContentRetained: false,
			},
			fingerprint: "b".repeat(64),
			extractionToken: EXTRACTION_TOKEN,
			selected: { kind: "image", mimeType: "image/png" },
		});

		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["synthetic"], "excluded.png", { type: "image/png" })] },
		});

		const extractionWarningHeading = await screen.findByText(
			"Resolve extraction warnings",
		);
		expect(extractionWarningHeading.closest('[role="status"]')).toHaveAttribute(
			"aria-live",
			"polite",
		);
		const reviewed = screen.getByRole("checkbox", { name: /^Reviewed deadline/ });
		const finalButton = screen.getByRole("button", {
			name: /Confirm and create 1 deadline/,
		});
		expect(reviewed).toBeDisabled();
		expect(finalButton).toBeDisabled();

		fireEvent.click(
			screen.getByRole("checkbox", {
				name: /^Resolve every warning for deadline/,
			}),
		);
		expect(reviewed).toBeEnabled();
		fireEvent.click(reviewed);
		expect(finalButton).toBeEnabled();
	});

	it("does not infer an ambiguous document date from the host locale", async () => {
		const fixture = RECEIPT_CAPTURE_CORPUS.find(
			(entry) => entry.id === "au-day-first-ambiguous-shape",
		);
		if (!fixture) throw new Error("fixture missing");
		extractSelectedDocument.mockResolvedValueOnce({
			extraction: {
				schema: "DocumentTextExtractionV1",
				kind: "image",
				engine: "apple-vision",
				pageCount: 1,
				lines: fixture.lines,
				processingMs: 8,
				rawContentRetained: false,
			},
			fingerprint: "c".repeat(64),
			extractionToken: EXTRACTION_TOKEN,
			selected: { kind: "image", mimeType: "image/png" },
		});

		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["synthetic"], "foreign.png", { type: "image/png" })] },
		});

		expect(
			await screen.findAllByText(
				"The numeric date needs an unambiguous order and a four-digit year.",
			),
		).not.toHaveLength(0);
		expect(screen.getByLabelText("Transaction date")).toHaveValue("");
		expect(
			screen.getByRole("button", { name: /Confirm and create 0 deadlines/ }),
		).toBeDisabled();
	});

	it("requires correction and both warning acknowledgements for an ambiguous date", async () => {
		const onOpenChange = vi.fn();
		const onCaptured = vi.fn();
		const fixture = RECEIPT_CAPTURE_CORPUS.find(
			(entry) => entry.id === "ambiguous-locale-date",
		);
		if (!fixture) throw new Error("fixture missing");
		extractSelectedDocument.mockResolvedValueOnce({
			extraction: {
				schema: "DocumentTextExtractionV1",
				kind: "pdf",
				engine: "pdfkit-apple-vision",
				pageCount: 1,
				lines: fixture.lines,
				processingMs: 8,
				rawContentRetained: false,
			},
			fingerprint: "9".repeat(64),
			extractionToken: EXTRACTION_TOKEN,
			selected: { kind: "pdf", mimeType: "application/pdf" },
		});

		render(
			<ImportReceiptModal
				open
				onOpenChange={onOpenChange}
				onCaptured={onCaptured}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: {
				files: [
					new File(["synthetic"], "synthetic-ambiguous-date-runtime-receipt.pdf", {
						type: "application/pdf",
					}),
				],
			},
		});

		await screen.findByText("Resolve receipt fact warnings");
		const date = screen.getByLabelText("Transaction date");
		const select = screen.getByRole("checkbox", { name: /^Select deadline 1:/ });
		const dueDate = screen.getByLabelText(/^Due date for deadline 1:/);
		const reviewed = screen.getByRole("checkbox", { name: /^Reviewed deadline 1:/ });
		expect(date).toHaveValue("");
		expect(dueDate).toHaveValue("");
		expect(select).not.toBeChecked();
		expect(reviewed).toBeDisabled();

		fireEvent.change(date, { target: { value: "2026-03-04" } });
		expect(dueDate).toHaveValue("2026-04-03");
		fireEvent.click(select);
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "I verified or corrected every receipt fact warning above",
			}),
		);
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: /^Resolve every warning for deadline 1:/,
			}),
		);
		expect(reviewed).toBeEnabled();
		fireEvent.click(reviewed);
		const confirm = screen.getByRole("button", {
			name: /Confirm and create 1 deadline/,
		});
		expect(confirm).toBeEnabled();
		fireEvent.click(confirm);

		await waitFor(() => expect(confirmDeadlineCapture).toHaveBeenCalledOnce());
		expect(confirmDeadlineCapture).toHaveBeenCalledWith(
			expect.objectContaining({
				merchant: "Atlas Goods",
				transactionDate: "2026-03-04",
				deadlines: [
					expect.objectContaining({
						dueDate: "2026-04-03",
						ambiguityResolved: true,
						reviewed: true,
						correctedFields: expect.arrayContaining([
							"transaction_date",
							"receipt_facts_resolution",
							"ambiguity_resolution",
						]),
					}),
				],
			}),
		);
		expect(onCaptured).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("requires receipt-fact warning resolution before confirmation", async () => {
		extractSelectedDocument.mockResolvedValueOnce({
			extraction: {
				schema: "DocumentTextExtractionV1",
				kind: "image",
				engine: "apple-vision",
				pageCount: 1,
				lines: [
					{ text: "Faint Merchant", confidence: 0.5, page: 1 },
					{ text: "Purchase date 01/15/2026", confidence: 0.96, page: 1 },
					{ text: "Travel Pouch $18.00", confidence: 0.96, page: 1 },
					{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
				],
				processingMs: 8,
				rawContentRetained: false,
			},
			fingerprint: "d".repeat(64),
			extractionToken: EXTRACTION_TOKEN,
			selected: { kind: "image", mimeType: "image/png" },
		});

		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["synthetic"], "faint.png", { type: "image/png" })] },
		});

		const receiptWarningHeading = await screen.findByText(
			"Resolve receipt fact warnings",
		);
		expect(receiptWarningHeading.closest('[role="status"]')).toHaveAttribute(
			"aria-live",
			"polite",
		);
		const reviewed = screen.getByRole("checkbox", { name: /^Reviewed deadline/ });
		const finalButton = screen.getByRole("button", {
			name: /Confirm and create 1 deadline/,
		});
		fireEvent.click(reviewed);
		expect(finalButton).toBeDisabled();

		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "I verified or corrected every receipt fact warning above",
			}),
		);
		expect(reviewed).not.toBeChecked();
		fireEvent.click(reviewed);
		expect(finalButton).toBeEnabled();
	});

	it("gates the aggregate missing-item warning", async () => {
		extractSelectedDocument.mockResolvedValueOnce({
			extraction: {
				schema: "DocumentTextExtractionV1",
				kind: "image",
				engine: "apple-vision",
				pageCount: 1,
				lines: [
					{ text: "Itemless Market", confidence: 0.96, page: 1 },
					{ text: "Purchase date 01/15/2026", confidence: 0.96, page: 1 },
					{ text: "Returns accepted within 30 days.", confidence: 0.96, page: 1 },
				],
				processingMs: 8,
				rawContentRetained: false,
			},
			fingerprint: "e".repeat(64),
			extractionToken: EXTRACTION_TOKEN,
			selected: { kind: "image", mimeType: "image/png" },
		});

		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["synthetic"], "itemless.png", { type: "image/png" })] },
		});

		expect(
			await screen.findAllByText("No purchased item candidates were found."),
		).not.toHaveLength(0);
		const reviewed = screen.getByRole("checkbox", { name: /^Reviewed deadline/ });
		const finalButton = screen.getByRole("button", {
			name: /Confirm and create 1 deadline/,
		});
		fireEvent.click(reviewed);
		expect(finalButton).toBeDisabled();

		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "I verified or corrected every receipt fact warning above",
			}),
		);
		fireEvent.click(reviewed);
		expect(finalButton).toBeEnabled();
	});

	it("caps selected deadlines at the native atomic limit", async () => {
		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: {
				files: [new File(["synthetic"], "bounded.png", { type: "image/png" })],
			},
		});

		await screen.findByText("Review every deadline");
		const addButton = screen.getByRole("button", { name: "Add manual deadline" });
		for (let index = 0; index < 7; index++) fireEvent.click(addButton);

		expect(screen.getAllByRole("checkbox", { name: /^Select deadline \d+:/ })).toHaveLength(8);
		expect(
			screen.getAllByRole("checkbox", { name: /^Reviewed deadline \d+:/ }),
		).toHaveLength(8);
		expect(addButton).toBeDisabled();
		fireEvent.click(addButton);
		expect(screen.getAllByRole("checkbox", { name: /^Select deadline \d+:/ })).toHaveLength(8);
	});

	it("blocks review when a deadline title exceeds the native limit", async () => {
		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: {
				files: [new File(["synthetic"], "long-title.png", { type: "image/png" })],
			},
		});

		await screen.findByText("Review every deadline");
		fireEvent.change(screen.getByLabelText(/^Title for deadline/), {
			target: { value: "x".repeat(201) },
		});

		expect(screen.getByText("Shorten this title before review.")).toBeInTheDocument();
		expect(
			screen.getByRole("checkbox", { name: /^Reviewed deadline/ }),
		).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /Confirm and create 1 deadline/ }),
		).toBeDisabled();
	});

	it("blocks confirmation when the merchant exceeds the native limit", async () => {
		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: {
				files: [new File(["synthetic"], "long-merchant.png", { type: "image/png" })],
			},
		});

		await screen.findByText("Review every deadline");
		fireEvent.change(screen.getByLabelText("Merchant"), {
			target: { value: "x".repeat(201) },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: /^Reviewed deadline/ }));

		expect(screen.getByText("Shorten the merchant before confirmation.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Confirm and create 1 deadline/ }),
		).toBeDisabled();
	});

	it("recovers from a failed local extraction by accepting a new selection", async () => {
		extractSelectedDocument.mockReset();
		extractSelectedDocument
			.mockRejectedValueOnce(new Error("unsafe_document: malformed synthetic PDF"))
			.mockResolvedValueOnce(selectedDocument("Recovered Market", "d"));
		render(<ImportReceiptModal open onOpenChange={vi.fn()} onCaptured={vi.fn()} />);

		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["broken"], "broken.pdf", { type: "application/pdf" })] },
		});
		expect(
			await screen.findByRole("alert", { name: "" }),
		).toHaveTextContent("unsafe_document: malformed synthetic PDF");

		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["valid"], "valid.png", { type: "image/png" })] },
		});
		await screen.findByText("Review every deadline");
		expect(screen.getByLabelText("Merchant")).toHaveValue("Recovered Market");
	});

	it("keeps the reviewed draft available when native persistence fails and retries", async () => {
		confirmDeadlineCapture.mockReset();
		confirmDeadlineCapture
			.mockRejectedValueOnce(new Error("Could not begin the local confirmation transaction"))
			.mockResolvedValueOnce(undefined);
		const onOpenChange = vi.fn();
		const onCaptured = vi.fn();
		render(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);

		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["valid"], "valid.png", { type: "image/png" })] },
		});
		await screen.findByText("Review every deadline");
		fireEvent.click(screen.getByRole("checkbox", { name: /^Reviewed deadline/ }));
		const confirm = screen.getByRole("button", {
			name: /Confirm and create 1 deadline/,
		});
		fireEvent.click(confirm);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Could not begin the local confirmation transaction",
		);
		expect(screen.getByLabelText("Merchant")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: /Retry and create 1 deadline/ }),
		);
		await waitFor(() => expect(confirmDeadlineCapture).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(onCaptured).toHaveBeenCalledOnce());
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("discards an extraction that completes after the modal is reset", async () => {
		const pending = deferred<ReturnType<typeof selectedDocument>>();
		extractSelectedDocument.mockReset();
		extractSelectedDocument.mockReturnValueOnce(pending.promise);
		const onOpenChange = vi.fn();
		const onCaptured = vi.fn();
		const { rerender } = render(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);

		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["first"], "first.png", { type: "image/png" })] },
		});
		await screen.findByText("Reading selected document");
		rerender(
			<ImportReceiptModal open={false} onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);
		await act(async () => pending.resolve(selectedDocument("Old Market", "f")));
		rerender(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);

		expect(await screen.findByText("Capture receipt deadlines")).toBeInTheDocument();
		expect(screen.queryByText("Review every deadline")).not.toBeInTheDocument();
		expect(screen.queryByText("Old Market")).not.toBeInTheDocument();
	});

	it("prevents an older extraction from overwriting a newer selection", async () => {
		const first = deferred<ReturnType<typeof selectedDocument>>();
		const second = deferred<ReturnType<typeof selectedDocument>>();
		extractSelectedDocument.mockReset();
		extractSelectedDocument
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const onOpenChange = vi.fn();
		const onCaptured = vi.fn();
		const { rerender } = render(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);

		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["first"], "first.png", { type: "image/png" })] },
		});
		await screen.findByText("Reading selected document");
		rerender(
			<ImportReceiptModal open={false} onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);
		rerender(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["second"], "second.png", { type: "image/png" })] },
		});

		await act(async () => second.resolve(selectedDocument("New Market", "e")));
		await screen.findByText("Review every deadline");
		expect(screen.getByLabelText("Merchant")).toHaveValue("New Market");
		expect(screen.getByText("second.png")).toBeInTheDocument();

		await act(async () => first.resolve(selectedDocument("Old Market", "f")));
		await waitFor(() => expect(screen.getByLabelText("Merchant")).toHaveValue("New Market"));
		expect(screen.getByText("second.png")).toBeInTheDocument();
		expect(screen.queryByText("Old Market")).not.toBeInTheDocument();
	});

	it("prevents an older save completion from closing a reopened review", async () => {
		const pendingSave = deferred<void>();
		extractSelectedDocument.mockReset();
		extractSelectedDocument
			.mockResolvedValueOnce(selectedDocument("First Market", "d"))
			.mockResolvedValueOnce(selectedDocument("Second Market", "e"));
		confirmDeadlineCapture.mockReset();
		confirmDeadlineCapture.mockReturnValueOnce(pendingSave.promise);
		const onOpenChange = vi.fn();
		const onCaptured = vi.fn();
		const { rerender } = render(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);

		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["first"], "first.png", { type: "image/png" })] },
		});
		await screen.findByText("Review every deadline");
		fireEvent.click(screen.getByRole("checkbox", { name: /^Reviewed deadline/ }));
		fireEvent.click(
			screen.getByRole("button", { name: /Confirm and create 1 deadline/ }),
		);
		await screen.findByText("Creating confirmed deadlines");

		rerender(
			<ImportReceiptModal open={false} onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);
		rerender(
			<ImportReceiptModal open onOpenChange={onOpenChange} onCaptured={onCaptured} />,
		);
		fireEvent.change(screen.getByLabelText("Choose receipt or policy document"), {
			target: { files: [new File(["second"], "second.png", { type: "image/png" })] },
		});
		await screen.findByText("Review every deadline");
		expect(screen.getByLabelText("Merchant")).toHaveValue("Second Market");

		await act(async () => pendingSave.resolve());
		await waitFor(() =>
			expect(screen.getByLabelText("Merchant")).toHaveValue("Second Market"),
		);
		expect(screen.getByText("second.png")).toBeInTheDocument();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(onCaptured).not.toHaveBeenCalled();
	});
});
