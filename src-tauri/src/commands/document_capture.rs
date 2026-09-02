use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;
use uuid::Uuid;

const MAX_DOCUMENT_BYTES: usize = 12 * 1024 * 1024;
const MAX_PDF_PAGES: usize = 25;
const MAX_EXTRACTED_CHARACTERS: usize = 500_000;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
const EMBEDDED_PDF_TEXT_CONFIDENCE: f32 = 0.68;
const MAX_CAPTURE_SESSIONS: usize = 16;
const CAPTURE_SESSION_LIFETIME: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub(crate) struct CaptureSession {
    fingerprint: String,
    kind: String,
    created_at: Instant,
}

#[derive(Debug, Default)]
pub(crate) struct CaptureSessionRegistry {
    sessions: Mutex<HashMap<String, CaptureSession>>,
}

impl CaptureSessionRegistry {
    fn prune(sessions: &mut HashMap<String, CaptureSession>) {
        sessions.retain(|_, session| session.created_at.elapsed() < CAPTURE_SESSION_LIFETIME);
        while sessions.len() >= MAX_CAPTURE_SESSIONS {
            let Some(oldest) = sessions
                .iter()
                .min_by_key(|(_, session)| session.created_at)
                .map(|(token, _)| token.clone())
            else {
                break;
            };
            sessions.remove(&oldest);
        }
    }

    pub(crate) fn register(&self, fingerprint: String, kind: String) -> Result<String, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Local extraction-session state is unavailable.".to_string())?;
        Self::prune(&mut sessions);
        let token = Uuid::new_v4().to_string();
        sessions.insert(
            token.clone(),
            CaptureSession {
                fingerprint,
                kind,
                created_at: Instant::now(),
            },
        );
        Ok(token)
    }

    pub(crate) fn take_matching(
        &self,
        token: &str,
        fingerprint: &str,
        kind: &str,
    ) -> Result<CaptureSession, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Local extraction-session state is unavailable.".to_string())?;
        Self::prune(&mut sessions);
        let matches = sessions
            .get(token)
            .is_some_and(|session| session.fingerprint == fingerprint && session.kind == kind);
        if !matches {
            return Err(
                "The confirmed deadline is not bound to this document extraction. Re-import and review the document."
                    .into(),
            );
        }
        sessions
            .remove(token)
            .ok_or_else(|| "The local extraction session is unavailable.".to_string())
    }

    pub(crate) fn restore(&self, token: String, session: CaptureSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Local extraction-session state could not be restored.".to_string())?;
        Self::prune(&mut sessions);
        sessions.insert(token, session);
        Ok(())
    }
}

fn ensure_extracted_character_limit(
    extracted_characters: usize,
    document_kind: &str,
) -> Result<(), String> {
    if extracted_characters > MAX_EXTRACTED_CHARACTERS {
        return Err(format!(
            "unsafe_document: extracted {document_kind} text exceeds the local limit"
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectedDocumentInput {
    data_base64: String,
    mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDocumentLine {
    text: String,
    confidence: f32,
    page: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTextExtraction {
    schema: &'static str,
    kind: &'static str,
    engine: &'static str,
    page_count: usize,
    lines: Vec<ExtractedDocumentLine>,
    processing_ms: u128,
    raw_content_retained: bool,
    source_fingerprint: String,
    extraction_token: String,
}

fn embedded_pdf_text_line(text: &str, page: usize) -> ExtractedDocumentLine {
    // PDFKit does not expose whether a text layer is authored text or prior OCR.
    // Preserve that uncertainty so dates from an embedded OCR layer require the
    // same explicit user resolution as other low-confidence evidence.
    ExtractedDocumentLine {
        text: text.to_string(),
        confidence: EMBEDDED_PDF_TEXT_CONFIDENCE,
        page,
    }
}

fn normalized_pdf_line(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn append_unique_pdf_lines(
    lines: &mut Vec<ExtractedDocumentLine>,
    extracted_characters: &mut usize,
    incoming: Vec<ExtractedDocumentLine>,
) -> Result<usize, String> {
    let mut seen: HashSet<(usize, String)> = lines
        .iter()
        .map(|line| (line.page, normalized_pdf_line(&line.text)))
        .collect();
    let mut added = 0usize;
    for line in incoming {
        let key = (line.page, normalized_pdf_line(&line.text));
        if key.1.is_empty() || !seen.insert(key) {
            continue;
        }
        *extracted_characters = extracted_characters.saturating_add(line.text.len());
        ensure_extracted_character_limit(*extracted_characters, "PDF")?;
        lines.push(line);
        added += 1;
    }
    Ok(added)
}

fn append_pdf_page_lines(
    lines: &mut Vec<ExtractedDocumentLine>,
    extracted_characters: &mut usize,
    embedded_lines: Vec<ExtractedDocumentLine>,
    vision_lines: Option<Vec<ExtractedDocumentLine>>,
) -> Result<(usize, usize), String> {
    // Rendered-page OCR preserves the visual reading order. Add it first, then
    // retain only unique embedded text as low-confidence supplemental evidence.
    let vision_count = append_unique_pdf_lines(
        lines,
        extracted_characters,
        vision_lines.unwrap_or_default(),
    )?;
    let embedded_count = append_unique_pdf_lines(lines, extracted_characters, embedded_lines)?;
    Ok((vision_count, embedded_count))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValidatedKind {
    Image,
    Pdf,
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut cursor = 2usize;
    while cursor < bytes.len() {
        while cursor < bytes.len() && bytes[cursor] != 0xff {
            cursor += 1;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let segment_length =
            u16::from_be_bytes([*bytes.get(cursor)?, *bytes.get(cursor.checked_add(1)?)?]) as usize;
        if segment_length < 2 || cursor.checked_add(segment_length)? > bytes.len() {
            return None;
        }
        let is_start_of_frame = matches!(
            marker,
            0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
        );
        if is_start_of_frame {
            if segment_length < 8 {
                return None;
            }
            let height =
                u16::from_be_bytes([*bytes.get(cursor + 3)?, *bytes.get(cursor + 4)?]) as u32;
            let width =
                u16::from_be_bytes([*bytes.get(cursor + 5)?, *bytes.get(cursor + 6)?]) as u32;
            return Some((width, height));
        }
        cursor += segment_length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 20 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let mut cursor = 12usize;
    while cursor.checked_add(8)? <= bytes.len() {
        let chunk_kind = bytes.get(cursor..cursor + 4)?;
        let chunk_length =
            u32::from_le_bytes(bytes.get(cursor + 4..cursor + 8)?.try_into().ok()?) as usize;
        let data_start = cursor.checked_add(8)?;
        let data_end = data_start.checked_add(chunk_length)?;
        if data_end > bytes.len() {
            return None;
        }
        let data = bytes.get(data_start..data_end)?;
        match chunk_kind {
            b"VP8X" if data.len() >= 10 => {
                let width = 1 + u32::from_le_bytes([data[4], data[5], data[6], 0]);
                let height = 1 + u32::from_le_bytes([data[7], data[8], data[9], 0]);
                return Some((width, height));
            }
            b"VP8 " if data.len() >= 10 && data[3..6] == [0x9d, 0x01, 0x2a] => {
                let width = u16::from_le_bytes([data[6], data[7]]) & 0x3fff;
                let height = u16::from_le_bytes([data[8], data[9]]) & 0x3fff;
                return Some((u32::from(width), u32::from(height)));
            }
            b"VP8L" if data.len() >= 5 && data[0] == 0x2f => {
                let width = 1 + u32::from(data[1]) + (u32::from(data[2] & 0x3f) << 8);
                let height = 1
                    + u32::from(data[2] >> 6)
                    + (u32::from(data[3]) << 2)
                    + (u32::from(data[4] & 0x0f) << 10);
                return Some((width, height));
            }
            _ => {}
        }
        cursor = data_end.checked_add(chunk_length & 1)?;
    }
    None
}

fn validate_image_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let dimensions = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        if bytes.len() < 24 || &bytes[12..16] != b"IHDR" {
            None
        } else {
            Some((
                u32::from_be_bytes(bytes[16..20].try_into().expect("fixed PNG width slice")),
                u32::from_be_bytes(bytes[20..24].try_into().expect("fixed PNG height slice")),
            ))
        }
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        jpeg_dimensions(bytes)
    } else {
        webp_dimensions(bytes)
    }
    .ok_or_else(|| "unsafe_document: image dimensions could not be validated".to_string())?;

    let (width, height) = dimensions;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || pixels > MAX_IMAGE_PIXELS
    {
        return Err(format!(
            "unsafe_document: image dimensions exceed the {MAX_IMAGE_DIMENSION}px and {MAX_IMAGE_PIXELS}-pixel local limits"
        ));
    }
    Ok(dimensions)
}

#[cfg(target_os = "macos")]
fn bounded_pdf_thumbnail_size(width: f64, height: f64) -> Result<(f64, f64), String> {
    let longest = width.max(height);
    if !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || !longest.is_finite()
    {
        return Err("unsafe_document: PDF page has invalid render bounds".into());
    }
    let scale = (2400.0 / longest).min(3.0);
    Ok((
        (width * scale).clamp(1.0, 2400.0),
        (height * scale).clamp(1.0, 2400.0),
    ))
}

fn validate_document_bytes(bytes: &[u8], mime_type: &str) -> Result<ValidatedKind, String> {
    if bytes.is_empty() {
        return Err("unsafe_document: the selected document is empty".into());
    }
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(format!(
            "unsafe_document: document exceeds the {} MB local processing limit",
            MAX_DOCUMENT_BYTES / 1024 / 1024
        ));
    }

    let is_pdf = bytes.starts_with(b"%PDF-");
    let is_png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    let is_jpeg = bytes.starts_with(&[0xff, 0xd8, 0xff]);
    let is_webp = bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP";

    match mime_type {
        "application/pdf" if is_pdf => Ok(ValidatedKind::Pdf),
        "image/png" if is_png => Ok(ValidatedKind::Image),
        "image/jpeg" if is_jpeg => Ok(ValidatedKind::Image),
        "image/webp" if is_webp => Ok(ValidatedKind::Image),
        "application/pdf" | "image/png" | "image/jpeg" | "image/webp" => {
            Err("unsafe_document: file signature does not match its declared type".into())
        }
        _ => Err("unsupported_document: select a PNG, JPEG, WebP, or PDF".into()),
    }
}

fn reject_active_pdf_content(bytes: &[u8]) -> Result<(), String> {
    const ACTIVE_NAMES: [&[u8]; 14] = [
        b"JavaScript",
        b"JS",
        b"Launch",
        b"EmbeddedFile",
        b"EmbeddedFiles",
        b"OpenAction",
        b"AA",
        b"SubmitForm",
        b"RichMedia",
        b"AcroForm",
        b"XFA",
        b"GoToR",
        b"URI",
        b"ObjStm",
    ];
    fn is_pdf_delimiter(byte: u8) -> bool {
        matches!(
            byte,
            0 | b'\t'
                | b'\n'
                | 0x0c
                | b'\r'
                | b' '
                | b'('
                | b')'
                | b'<'
                | b'>'
                | b'['
                | b']'
                | b'{'
                | b'}'
                | b'/'
                | b'%'
        )
    }

    fn hex_value(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'/' {
            index += 1;
            continue;
        }
        index += 1;
        let mut decoded = Vec::new();
        while index < bytes.len() && !is_pdf_delimiter(bytes[index]) {
            if bytes[index] == b'#' && index + 2 < bytes.len() {
                if let (Some(high), Some(low)) =
                    (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
                {
                    decoded.push((high << 4) | low);
                    index += 3;
                    continue;
                }
            }
            decoded.push(bytes[index]);
            index += 1;
        }
        if ACTIVE_NAMES.iter().any(|name| decoded == *name) {
            return Err(
                "unsafe_document: active, embedded, remote, form, or opaque PDF content is not processed"
                    .into(),
            );
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn recognize_image_data(
    data: &objc2_foundation::NSData,
    page: usize,
) -> Result<Vec<ExtractedDocumentLine>, String> {
    use objc2::AnyThread;
    use objc2_foundation::{NSArray, NSDictionary};
    use objc2_vision::{
        VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
        VNRequestTextRecognitionLevel,
    };

    let options = NSDictionary::<VNImageOption, objc2::runtime::AnyObject>::new();
    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    request.setAutomaticallyDetectsLanguage(true);
    let handler =
        VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), data, &options);
    let request_ref: &VNRequest = request.as_ref();
    let requests = NSArray::from_slice(&[request_ref]);
    handler
        .performRequests_error(&requests)
        .map_err(|error| format!("unsafe_document: Vision could not decode the image: {error}"))?;

    let observations = request
        .results()
        .ok_or_else(|| "ocr_low_confidence: no text was recognized".to_string())?;
    let mut lines = Vec::with_capacity(observations.count());
    for index in 0..observations.count() {
        let observation = observations.objectAtIndex(index);
        let candidates = observation.topCandidates(1);
        if candidates.count() == 0 {
            continue;
        }
        let candidate = candidates.objectAtIndex(0);
        let text = candidate.string().to_string().trim().to_string();
        if text.is_empty() {
            continue;
        }
        lines.push(ExtractedDocumentLine {
            text,
            confidence: candidate.confidence(),
            page,
        });
    }
    if lines.is_empty() {
        return Err("ocr_low_confidence: no readable text was found in the image".into());
    }
    Ok(lines)
}

#[cfg(target_os = "macos")]
fn extract_image_lines(bytes: &[u8]) -> Result<Vec<ExtractedDocumentLine>, String> {
    use objc2_foundation::NSData;

    validate_image_dimensions(bytes)?;
    let data = NSData::with_bytes(bytes);
    recognize_image_data(&data, 1)
}

#[cfg(not(target_os = "macos"))]
fn extract_image_lines(_bytes: &[u8]) -> Result<Vec<ExtractedDocumentLine>, String> {
    Err("unsupported_document: local image OCR requires macOS Vision".into())
}

#[cfg(target_os = "macos")]
fn extract_pdf_lines(
    bytes: &[u8],
) -> Result<(Vec<ExtractedDocumentLine>, usize, &'static str), String> {
    use objc2::AnyThread;
    use objc2_foundation::{NSData, NSSize};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};

    reject_active_pdf_content(bytes)?;
    let data = NSData::with_bytes(bytes);
    // SAFETY: PDFKit owns the copied NSData for the document lifetime. No path,
    // URL, external resource, password, or write API is passed to the framework.
    let document = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
        .ok_or_else(|| "unsafe_document: PDFKit rejected the malformed PDF".to_string())?;
    // SAFETY: These are immutable PDFKit accessors on the retained document.
    if unsafe { document.isEncrypted() || document.isLocked() } {
        return Err("unsupported_document: encrypted PDFs are not processed".into());
    }
    let page_count = unsafe { document.pageCount() };
    if page_count == 0 || page_count > MAX_PDF_PAGES {
        return Err(format!(
            "unsafe_document: PDF must contain between 1 and {MAX_PDF_PAGES} pages"
        ));
    }

    let mut lines = Vec::new();
    let mut extracted_characters = 0usize;
    let mut used_embedded_text = false;
    let mut used_vision_ocr = false;
    for page_index in 0..page_count {
        let Some(page) = (unsafe { document.pageAtIndex(page_index) }) else {
            return Err("unsafe_document: PDF page could not be decoded".into());
        };
        let mut embedded_page_lines = Vec::new();
        if let Some(page_text) = unsafe { page.string() } {
            for line in page_text.to_string().lines() {
                let text = line.trim();
                if text.is_empty() {
                    continue;
                }
                embedded_page_lines.push(embedded_pdf_text_line(text, page_index + 1));
            }
        }
        let has_embedded_page_text = !embedded_page_lines.is_empty();

        // A text layer may contain only a scanner header, page number, or
        // watermark while the actual receipt remains an image. Render every
        // bounded page and merge unique Vision lines so incidental text cannot
        // suppress OCR of the selected document.
        let bounds = unsafe { page.boundsForBox(PDFDisplayBox::CropBox) };
        let (thumbnail_width, thumbnail_height) =
            bounded_pdf_thumbnail_size(bounds.size.width, bounds.size.height)?;
        let thumbnail = unsafe {
            page.thumbnailOfSize_forBox(
                NSSize::new(thumbnail_width, thumbnail_height),
                PDFDisplayBox::CropBox,
            )
        };
        let tiff = thumbnail.TIFFRepresentation().ok_or_else(|| {
            "unsafe_document: PDF page could not be rendered for local OCR".to_string()
        })?;
        let vision_page_lines = match recognize_image_data(&tiff, page_index + 1) {
            Ok(page_lines) => {
                used_vision_ocr = true;
                Some(page_lines)
            }
            Err(error) if error.starts_with("ocr_low_confidence:") => None,
            Err(_) if has_embedded_page_text => None,
            Err(error) => return Err(error),
        };
        let (_, embedded_line_count) = append_pdf_page_lines(
            &mut lines,
            &mut extracted_characters,
            embedded_page_lines,
            vision_page_lines,
        )?;
        used_embedded_text |= embedded_line_count > 0;
    }
    if lines.is_empty() {
        return Err("ocr_low_confidence: no readable text was found in the PDF".into());
    }
    let engine = match (used_embedded_text, used_vision_ocr) {
        (true, true) => "pdfkit-text+apple-vision",
        (false, true) => "pdfkit-apple-vision",
        _ => "pdfkit-text",
    };
    Ok((lines, page_count, engine))
}

#[cfg(not(target_os = "macos"))]
fn extract_pdf_lines(
    _bytes: &[u8],
) -> Result<(Vec<ExtractedDocumentLine>, usize, &'static str), String> {
    Err("unsupported_document: local PDF extraction requires macOS PDFKit".into())
}

fn extract_document_text_sync(
    input: SelectedDocumentInput,
) -> Result<DocumentTextExtraction, String> {
    if input.data_base64.len() > (MAX_DOCUMENT_BYTES * 4 / 3) + 16 {
        return Err("unsafe_document: encoded document exceeds the local processing limit".into());
    }
    let bytes = BASE64
        .decode(input.data_base64.as_bytes())
        .map_err(|_| "unsafe_document: document data is not valid base64".to_string())?;
    let source_fingerprint = hex::encode(Sha256::digest(&bytes));
    let kind = validate_document_bytes(&bytes, &input.mime_type)?;
    let started = Instant::now();
    let (lines, page_count, kind_name, engine) = match kind {
        ValidatedKind::Image => {
            let lines = extract_image_lines(&bytes)?;
            let extracted_characters = lines
                .iter()
                .fold(0usize, |total, line| total.saturating_add(line.text.len()));
            ensure_extracted_character_limit(extracted_characters, "image")?;
            (lines, 1, "image", "apple-vision")
        }
        ValidatedKind::Pdf => {
            let (lines, pages, engine) = extract_pdf_lines(&bytes)?;
            (lines, pages, "pdf", engine)
        }
    };
    Ok(DocumentTextExtraction {
        schema: "DocumentTextExtractionV1",
        kind: kind_name,
        engine,
        page_count,
        lines,
        processing_ms: started.elapsed().as_millis(),
        raw_content_retained: false,
        source_fingerprint,
        extraction_token: String::new(),
    })
}

#[tauri::command]
pub async fn extract_document_text(
    sessions: State<'_, CaptureSessionRegistry>,
    input: SelectedDocumentInput,
) -> Result<DocumentTextExtraction, String> {
    let mut extraction =
        tauri::async_runtime::spawn_blocking(move || extract_document_text_sync(input))
            .await
            .map_err(|_| {
                "unsafe_document: local extraction worker stopped unexpectedly".to_string()
            })??;
    extraction.extraction_token = sessions.register(
        extraction.source_fingerprint.clone(),
        extraction.kind.to_string(),
    )?;
    Ok(extraction)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_documents() {
        let bytes = vec![0u8; MAX_DOCUMENT_BYTES + 1];
        assert!(validate_document_bytes(&bytes, "image/png")
            .unwrap_err()
            .contains("exceeds"));
    }

    #[test]
    fn enforces_the_same_extracted_text_limit_for_images_and_pdfs() {
        assert!(ensure_extracted_character_limit(MAX_EXTRACTED_CHARACTERS, "image").is_ok());
        assert!(ensure_extracted_character_limit(MAX_EXTRACTED_CHARACTERS, "PDF").is_ok());
        assert!(
            ensure_extracted_character_limit(MAX_EXTRACTED_CHARACTERS + 1, "image")
                .unwrap_err()
                .contains("image text exceeds")
        );
        assert!(
            ensure_extracted_character_limit(MAX_EXTRACTED_CHARACTERS + 1, "PDF")
                .unwrap_err()
                .contains("PDF text exceeds")
        );
    }

    fn synthetic_png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn rejects_oversized_or_excessive_pixel_image_headers_before_decode() {
        assert_eq!(
            validate_image_dimensions(&synthetic_png_header(2_000, 3_000)).unwrap(),
            (2_000, 3_000)
        );
        assert!(
            validate_image_dimensions(&synthetic_png_header(20_000, 100))
                .unwrap_err()
                .contains("dimensions exceed")
        );
        assert!(
            validate_image_dimensions(&synthetic_png_header(10_000, 5_000))
                .unwrap_err()
                .contains("dimensions exceed")
        );
    }

    #[test]
    fn reads_jpeg_and_webp_dimensions_without_decoding_pixels() {
        let jpeg = [
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x02, 0x58, 0x03, 0x20, 0x01,
        ];
        assert_eq!(validate_image_dimensions(&jpeg).unwrap(), (800, 600));

        let mut webp = b"RIFF\x12\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".to_vec();
        webp.extend_from_slice(&[0x7f, 0x02, 0x00, 0x57, 0x01, 0x00]);
        assert_eq!(validate_image_dimensions(&webp).unwrap(), (640, 344));

        let mut lossy_webp = b"RIFF\x12\0\0\0WEBPVP8 \x0a\0\0\0".to_vec();
        lossy_webp.extend_from_slice(&[0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00]);
        assert_eq!(validate_image_dimensions(&lossy_webp).unwrap(), (320, 240));

        let mut lossless_webp = b"RIFF\x0e\0\0\0WEBPVP8L\x05\0\0\0".to_vec();
        lossless_webp.extend_from_slice(&[0x2f, 0x7f, 0xc2, 0x77, 0x00]);
        assert_eq!(
            validate_image_dimensions(&lossless_webp).unwrap(),
            (640, 480)
        );

        assert!(validate_image_dimensions(b"\xff\xd8\xff\xc0\0\x20truncated").is_err());
        assert!(
            validate_image_dimensions(b"RIFF\xff\xff\xff\xffWEBPVP8X\xff\xff\xff\xff").is_err()
        );
    }

    #[test]
    fn embedded_pdf_text_preserves_ocr_uncertainty() {
        let line = embedded_pdf_text_line("Purchase date 01/15/2026", 2);
        assert_eq!(line.text, "Purchase date 01/15/2026");
        assert_eq!(line.page, 2);
        assert!(line.confidence < 0.7);
    }

    #[test]
    fn mixed_pdf_page_keeps_embedded_text_and_unique_ocr_lines() {
        let mut lines = Vec::new();
        let mut extracted_characters = 0;
        let (vision_added, embedded_added) = append_pdf_page_lines(
            &mut lines,
            &mut extracted_characters,
            vec![
                embedded_pdf_text_line("Scanned by Acme", 1),
                embedded_pdf_text_line("northstar   outfitters", 1),
            ],
            Some(vec![
                ExtractedDocumentLine {
                    text: "Northstar Outfitters".into(),
                    confidence: 0.95,
                    page: 1,
                },
                ExtractedDocumentLine {
                    text: "Trail Bottle $24.00".into(),
                    confidence: 0.95,
                    page: 1,
                },
                ExtractedDocumentLine {
                    text: "Returns accepted within 30 days.".into(),
                    confidence: 0.95,
                    page: 1,
                },
            ]),
        )
        .unwrap();

        assert_eq!(vision_added, 3);
        assert_eq!(embedded_added, 1);
        assert_eq!(lines[0].text, "Northstar Outfitters");
        assert_eq!(lines[1].text, "Trail Bottle $24.00");
        assert_eq!(lines[3].text, "Scanned by Acme");
    }

    #[test]
    fn mixed_pdf_page_falls_back_to_embedded_order_without_vision_lines() {
        let mut lines = Vec::new();
        let mut extracted_characters = 0;
        let (vision_added, embedded_added) = append_pdf_page_lines(
            &mut lines,
            &mut extracted_characters,
            vec![
                embedded_pdf_text_line("Northstar Outfitters", 1),
                embedded_pdf_text_line("Returns within 30 days", 1),
            ],
            None,
        )
        .unwrap();

        assert_eq!(vision_added, 0);
        assert_eq!(embedded_added, 2);
        assert_eq!(lines[0].text, "Northstar Outfitters");
        assert_eq!(lines[1].text, "Returns within 30 days");
    }

    #[test]
    fn rejects_mime_signature_mismatch_and_malformed_images() {
        assert!(validate_document_bytes(b"not-a-png", "image/png")
            .unwrap_err()
            .contains("signature"));
    }

    #[test]
    fn rejects_active_pdf_content_before_pdfkit() {
        let malicious = b"%PDF-1.7\n1 0 obj << /OpenAction 2 0 R /JavaScript (launch) >>";
        assert!(reject_active_pdf_content(malicious)
            .unwrap_err()
            .contains("not processed"));
    }

    #[test]
    fn rejects_encoded_and_opaque_pdf_action_names() {
        for malicious in [
            b"%PDF-1.7\n<< /Java#53cript (launch) >>".as_slice(),
            b"%PDF-1.7\n<< /EmbeddedFiles 2 0 R >>".as_slice(),
            b"%PDF-1.7\n<< /Type /ObjStm >>".as_slice(),
        ] {
            assert!(reject_active_pdf_content(malicious)
                .unwrap_err()
                .contains("not processed"));
        }
    }

    #[test]
    fn accepts_pdf_names_that_only_share_an_active_marker_prefix() {
        let benign = b"%PDF-1.7\n<< /BaseFont /AAAAAB+Synthetic /Metadata (safe) >>";
        assert!(reject_active_pdf_content(benign).is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn bounds_pathological_pdf_thumbnail_dimensions() {
        assert_eq!(
            bounded_pdf_thumbnail_size(100_000.0, 50_000.0).unwrap(),
            (2400.0, 1200.0)
        );
        assert_eq!(
            bounded_pdf_thumbnail_size(100.0, 200.0).unwrap(),
            (300.0, 600.0)
        );
        assert!(bounded_pdf_thumbnail_size(f64::INFINITY, 100.0).is_err());
        assert!(bounded_pdf_thumbnail_size(0.0, 100.0).is_err());
    }

    #[test]
    fn command_contract_accepts_bytes_not_paths() {
        let attempt = serde_json::from_value::<SelectedDocumentInput>(serde_json::json!({
            "dataBase64": "JVBERi0=",
            "mimeType": "application/pdf",
            "path": "../../Downloads/private.pdf"
        }));
        assert!(
            attempt.is_err(),
            "path and symlink inputs must remain outside the command contract"
        );
    }

    #[test]
    fn binds_confirmation_to_one_native_extraction_session() {
        let sessions = CaptureSessionRegistry::default();
        let fingerprint = "a".repeat(64);
        let token = sessions
            .register(fingerprint.clone(), "pdf".into())
            .expect("register extraction session");

        assert!(sessions
            .take_matching(&token, &"b".repeat(64), "pdf")
            .is_err());
        let claimed = sessions
            .take_matching(&token, &fingerprint, "pdf")
            .expect("matching extraction session");
        assert!(sessions.take_matching(&token, &fingerprint, "pdf").is_err());
        sessions
            .restore(token.clone(), claimed)
            .expect("restore extraction session");
        assert!(sessions.take_matching(&token, &fingerprint, "pdf").is_ok());
    }

    #[test]
    fn rejects_invalid_base64_without_panicking() {
        let result = extract_document_text_sync(SelectedDocumentInput {
            data_base64: "%%%".into(),
            mime_type: "image/png".into(),
        });
        assert!(result.unwrap_err().contains("base64"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_truncated_image_after_valid_signature_without_panicking() {
        let malformed = b"\x89PNG\r\n\x1a\ntruncated";
        let error = extract_image_lines(malformed).unwrap_err();
        assert!(
            error.contains("dimensions could not be validated")
                || error.contains("Vision could not decode")
                || error.contains("no readable text")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_malformed_pdf_after_valid_signature_without_panicking() {
        let malformed = b"%PDF-1.7\nnot a valid object graph";
        let error = extract_pdf_lines(malformed).unwrap_err();
        assert!(error.contains("malformed PDF"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn extracts_project_owned_synthetic_scanned_pdf_fixture_with_vision() {
        let bytes = include_bytes!("../../../output/pdf/synthetic-runtime-receipt.pdf");
        let (lines, page_count, engine) = extract_pdf_lines(bytes).expect("extract scanned PDF");
        let joined = lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        assert_eq!(page_count, 1);
        assert_eq!(engine, "pdfkit-apple-vision");
        assert!(joined.contains("northstar"));
        assert!(joined.contains("return"));
        assert!(lines.iter().all(|line| line.page == 1));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn extracts_project_owned_ambiguous_date_pdf_fixture_with_vision() {
        let bytes =
            include_bytes!("../../../output/pdf/synthetic-ambiguous-date-runtime-receipt.pdf");
        let extraction = extract_document_text_sync(SelectedDocumentInput {
            data_base64: BASE64.encode(bytes),
            mime_type: "application/pdf".into(),
        })
        .expect("extract ambiguous PDF through the native command core");
        let joined = extraction
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        assert_eq!(extraction.page_count, 1);
        assert_eq!(extraction.kind, "pdf");
        assert_eq!(extraction.engine, "pdfkit-apple-vision");
        assert_eq!(extraction.source_fingerprint.len(), 64);
        assert!(!extraction.raw_content_retained);
        assert!(joined.contains("atlas goods"));
        assert!(joined.contains("03/04/2026"));
        assert!(joined.contains("30 days"));
        assert!(extraction.lines.iter().all(|line| line.page == 1));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an explicitly selected synthetic mixed-content PDF fixture"]
    fn extracts_image_receipt_from_mixed_content_pdf_fixture() {
        let path = std::env::var("RETURNRADAR_MIXED_PDF_FIXTURE")
            .expect("set RETURNRADAR_MIXED_PDF_FIXTURE to a synthetic PDF path");
        let bytes = std::fs::read(path).expect("read explicitly selected synthetic mixed PDF");
        let (lines, page_count, engine) = extract_pdf_lines(&bytes).expect("extract mixed PDF");
        let joined = lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        assert_eq!(page_count, 1);
        assert_eq!(engine, "pdfkit-text+apple-vision");
        assert!(joined.contains("scanner watermark"));
        assert!(joined.contains("northstar"));
        assert!(joined.contains("return"));
    }
}
