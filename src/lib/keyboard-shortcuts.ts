const EDITABLE_CONTROL_SELECTOR = [
	"input",
	"textarea",
	"select",
	'[contenteditable="true"]',
	'[role="textbox"]',
	'[role="combobox"]',
].join(", ");

export function shouldHandleGlobalShortcut(
	event: KeyboardEvent,
	modalOpen: boolean,
): boolean {
	if (!event.metaKey || modalOpen) return false;
	const target = event.target;
	return !(target instanceof Element && target.closest(EDITABLE_CONTROL_SELECTOR));
}
