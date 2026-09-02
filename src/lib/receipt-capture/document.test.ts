import { describe, expect, it } from "vitest";
import {
	MAX_SELECTED_DOCUMENT_BYTES,
	validateSelectedDocument,
} from "./document";

function selectedFile(
	name: string,
	type: string,
	size = 8,
	webkitRelativePath = "",
): File {
	const file = new File([new Uint8Array(size)], name, { type });
	Object.defineProperty(file, "webkitRelativePath", { value: webkitRelativePath });
	return file;
}

describe("selected document boundary", () => {
	it("accepts one explicitly selected image or PDF", () => {
		expect(validateSelectedDocument(selectedFile("receipt.png", "image/png")).kind).toBe(
			"image",
		);
		expect(
			validateSelectedDocument(selectedFile("policy.pdf", "application/pdf")).kind,
		).toBe("pdf");
	});

	it("infers a supported type when browser MIME metadata is absent", () => {
		expect(validateSelectedDocument(selectedFile("receipt.JPG", ""))).toMatchObject({
			kind: "image",
			mimeType: "image/jpeg",
		});
		expect(validateSelectedDocument(selectedFile("policy.PDF", ""))).toMatchObject({
			kind: "pdf",
			mimeType: "application/pdf",
		});
	});

	it("rejects oversized files before invoking native extraction", () => {
		expect(() =>
			validateSelectedDocument(
				selectedFile("large.png", "image/png", MAX_SELECTED_DOCUMENT_BYTES + 1),
			),
		).toThrow(/too large/);
	});

	it("rejects malformed or unsupported declared formats", () => {
		expect(() => validateSelectedDocument(selectedFile("receipt.txt", "text/plain"))).toThrow(
			/PNG, JPEG, WebP, or PDF/,
		);
		expect(() => validateSelectedDocument(selectedFile("receipt.bin", ""))).toThrow(
			/PNG, JPEG, WebP, or PDF/,
		);
	});

	it("rejects folder and path-bearing selections", () => {
		expect(() =>
			validateSelectedDocument(
				selectedFile("receipt.png", "image/png", 8, "../../Downloads/receipt.png"),
			),
		).toThrow(/Folder, path, and symlink/);
	});
});
