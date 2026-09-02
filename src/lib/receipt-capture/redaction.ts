const PAYMENT_CARD_PATTERN =
	/\b(?:(?:\d{4}[ -]){2,3}\d{4}|(?:\d{4}[ -]){4}\d{3}|\d{4}[ -]\d{6}[ -]\d{5}|\d{12,19})\b/g;
const PAYMENT_CARD_FRAGMENT_PATTERN =
	/\b(?:card|visa|mastercard|amex|discover)\s*(?:ending(?:\s+in)?|ends?\s+in|last\s*4|no|number|#)?\s*[:#-]?\s*(?:[*xX•][*xX• -]*)?(?:\d[ -]?){3}\d\b/gi;
const ADDRESS_START_PATTERN =
	/\b\d{1,6}\s+(?:(?:\d+(?:st|nd|rd|th)|[A-Za-z][A-Za-z0-9.'-]*)\s+){1,6}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Circle|Cir|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Place|Pl|Plaza|Plz|Square|Sq|Trail|Trl|Crescent|Cres|Turnpike|Tpke)\b/i;
const DURATION_ADDRESS_PREFIX_PATTERN = /^\d{1,6}\s+(?:days?|weeks?|months?|years?)\b/i;
const POLICY_AFTER_ADDRESS_PATTERN =
	/\b(?:(?:we|store|merchant)\s+(?:(?:do|does|did)(?:\s+(?:not|never)|n['’]?t)\s+accept|den(?:y|ies|ied)|refus(?:e|es|ed))\s+(?:returns?|refunds?|exchanges?)|(?:(?:do|does|did)\s+(?:not|never)|(?:do|does|did)n['’]?t|can(?:not|['’]t)|(?:could|would|might)n['’]?t|(?:will|may|might|must|shall|should|could|would)\s+(?:not|never)|(?:may|must|shall|should)n['’]?t|won['’]?t)\s+accept\s+(?:returns?|refunds?|exchanges?)|no\s+(?:returns?|refunds?|exchanges?|warrant(?:y|ies))|(?:not|never)\s+(?:covered|included)\s+(?:by|under)\s+(?:the\s+)?warrant(?:y|ies)|except(?:\s+[A-Za-z0-9&/'-]+){0,8}\s+(?:returns?|refunds?|exchanges?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment))|excluded(?:\s+[A-Za-z0-9&/'-]+){0,6}\s+warrant(?:y|ies)|non-?returnable|(?:not|never)\s+returnable|return(?:s|ed)?|refund(?:s|ed)?|exchange(?:s|d)?|rebates?|warrant(?:y|ies)|price\s*(?:match|adjustment)|final\s+sale|all\s+sales?)\b/i;
const POLICY_PREFIX_BEFORE_KEYWORD_PATTERN =
	/\b(?:\d{1,4}(?:\s+|[-‐‑‒–—]\s*)(?:days?|weeks?|months?|years?)|opened|unopened|unused|used|damaged|defective|sale|clearance|custom|personalized|perishable|electronics|items?|products?|goods|may|must|can|cannot|not|never|no|except|excluded)\b/i;
const LABELED_IDENTIFIER_PATTERN =
	/\b(?:transaction|trans|order|receipt|invoice|document|confirmation|reference|ref|loyalty|member|rewards|account)\b\s*(?:(?:(?:id|no|number)\s*\.?|#)\s*[:,#-]?|[:,#-])\s*[A-Z0-9][A-Z0-9/._-]{1,}\b/gi;

function redactAddressesPreservingPolicy(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			let cursor = 0;
			let redacted = "";
			while (cursor < line.length) {
				const remaining = line.slice(cursor);
				const address = ADDRESS_START_PATTERN.exec(remaining);
				if (!address || address.index === undefined) {
					redacted += remaining;
					break;
				}
				const addressStart = cursor + address.index;
				const addressEnd = addressStart + address[0].length;
				if (DURATION_ADDRESS_PREFIX_PATTERN.test(address[0])) {
					redacted += line.slice(cursor, addressEnd);
					cursor = addressEnd;
					continue;
				}
				redacted += `${line.slice(cursor, addressStart)}[ADDRESS REDACTED]`;
				const tail = line.slice(addressEnd);
				const policy = POLICY_AFTER_ADDRESS_PATTERN.exec(tail);
				if (!policy || policy.index === undefined) {
					cursor = line.length;
					break;
				}
				const policyPrefix = POLICY_PREFIX_BEFORE_KEYWORD_PATTERN.exec(
					tail.slice(0, policy.index),
				);
				redacted += " ";
				cursor = addressEnd + (policyPrefix?.index ?? policy.index);
			}
			return redacted;
		})
		.join("\n");
}

export function redactSensitiveText(text: string): string {
	const redacted = text
		.replace(PAYMENT_CARD_PATTERN, "[PAYMENT CARD REDACTED]")
		.replace(PAYMENT_CARD_FRAGMENT_PATTERN, "[PAYMENT CARD REDACTED]");
	return redactAddressesPreservingPolicy(redacted)
		.replace(LABELED_IDENTIFIER_PATTERN, (match) =>
			/\b(?:loyalty|member|rewards)\b/i.test(match)
				? "[LOYALTY IDENTIFIER REDACTED]"
				: "[TRANSACTION IDENTIFIER REDACTED]",
		);
}

export function sanitizeDocumentLabel(kind: "image" | "pdf", hash: string) {
	const safeHash = hash.replace(/[^a-f0-9]/gi, "").slice(0, 10) || "unknown";
	return `${kind === "pdf" ? "PDF" : "Image"} • ${safeHash}`;
}
