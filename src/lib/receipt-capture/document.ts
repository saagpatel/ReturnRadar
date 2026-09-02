import { invoke } from "@tauri-apps/api/core";
import type { OcrLine } from "./types";

export const MAX_SELECTED_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const SUPPORTED_DOCUMENT_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"application/pdf",
] as const;

type SupportedDocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];

const DOCUMENT_TYPE_BY_EXTENSION: Readonly<Record<string, SupportedDocumentType>> = {
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	pdf: "application/pdf",
	png: "image/png",
	webp: "image/webp",
};

export interface DocumentTextExtraction {
	schema: "DocumentTextExtractionV1";
	kind: "image" | "pdf";
	engine:
		| "apple-vision"
		| "pdfkit-text"
		| "pdfkit-apple-vision"
		| "pdfkit-text+apple-vision";
	pageCount: number;
	lines: OcrLine[];
	processingMs: number;
	rawContentRetained: false;
	sourceFingerprint: string;
	extractionToken: string;
}

export interface SelectedDocument {
	file: File;
	mimeType: SupportedDocumentType;
	kind: "image" | "pdf";
}

function resolveSelectedDocumentType(file: File): SupportedDocumentType {
	if (SUPPORTED_DOCUMENT_TYPES.includes(file.type as SupportedDocumentType)) {
		return file.type as SupportedDocumentType;
	}
	if (file.type !== "") {
		throw new Error("Select a PNG, JPEG, WebP, or PDF document.");
	}

	const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
	const inferredType = extension ? DOCUMENT_TYPE_BY_EXTENSION[extension] : undefined;
	if (!inferredType) {
		throw new Error("Select a PNG, JPEG, WebP, or PDF document.");
	}
	return inferredType;
}

export function validateSelectedDocument(file: File): SelectedDocument {
	if (file.size === 0) throw new Error("The selected document is empty.");
	if (file.size > MAX_SELECTED_DOCUMENT_BYTES) {
		throw new Error("The selected document is too large (12 MB maximum).");
	}
	const relativePath = file.webkitRelativePath;
	if (
		relativePath ||
		file.name.includes("/") ||
		file.name.includes("\\") ||
		file.name === ".." ||
		file.name.includes("../")
	) {
		throw new Error("Folder, path, and symlink-style selections are not accepted.");
	}
	// Browsers can omit File.type for a valid user-selected document. In that
	// case the extension only selects the native decoder; the native boundary
	// still verifies the actual signature before OCR or PDF parsing begins.
	const mimeType = resolveSelectedDocumentType(file);
	return {
		file,
		mimeType,
		kind: mimeType === "application/pdf" ? "pdf" : "image",
	};
}

function bytesToBase64(bytes: Uint8Array): string {
	const chunks: string[] = [];
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
	}
	return btoa(chunks.join(""));
}

export async function extractSelectedDocument(file: File): Promise<{
	extraction: DocumentTextExtraction;
	fingerprint: string;
	extractionToken: string;
	selected: SelectedDocument;
}> {
	const selected = validateSelectedDocument(file);
	const bytes = new Uint8Array(await file.arrayBuffer());
	let dataBase64 = bytesToBase64(bytes);
	try {
		const extraction = await invoke<DocumentTextExtraction>("extract_document_text", {
			input: {
				dataBase64,
				mimeType: selected.mimeType,
			},
		});
		return {
			extraction,
			fingerprint: extraction.sourceFingerprint,
			extractionToken: extraction.extractionToken,
			selected,
		};
	} finally {
		bytes.fill(0);
		dataBase64 = "";
	}
}
