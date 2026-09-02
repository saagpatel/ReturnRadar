import { describe, expect, it } from "vitest";
import { shouldHandleGlobalShortcut } from "./keyboard-shortcuts";

function shortcutEvent(target: Element | null, metaKey = true): KeyboardEvent {
	const event = new KeyboardEvent("keydown", { key: "1", metaKey });
	Object.defineProperty(event, "target", { value: target });
	return event;
}

describe("global keyboard shortcut gating", () => {
	it("handles command shortcuts on the application shell", () => {
		expect(shouldHandleGlobalShortcut(shortcutEvent(document.body), false)).toBe(true);
	});

	it("ignores every global shortcut while a modal is open", () => {
		expect(shouldHandleGlobalShortcut(shortcutEvent(document.body), true)).toBe(false);
	});

	it.each(["input", "textarea", "select"])(
		"ignores command shortcuts while editing a %s",
		(tagName) => {
			const control = document.createElement(tagName);
			expect(shouldHandleGlobalShortcut(shortcutEvent(control), false)).toBe(false);
		},
	);

	it("ignores non-command key presses", () => {
		expect(shouldHandleGlobalShortcut(shortcutEvent(document.body, false), false)).toBe(
			false,
		);
	});
});
