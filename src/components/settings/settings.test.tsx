import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/hooks/use-settings", () => ({
	useSettings: () => ({
		loading: false,
		settings: {
			defaultReturnDays: 30,
			theme: "system",
			notify7day: true,
			notify1day: true,
		},
		updateSetting: vi.fn(),
	}),
}));

describe("legacy receipt API key cleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("offers explicit cleanup without reading the secret into the UI", async () => {
		invoke.mockImplementation((command: string) => {
			if (command === "has_legacy_api_key") return Promise.resolve(true);
			if (command === "delete_legacy_api_key") return Promise.resolve();
			return Promise.reject(new Error(`unexpected command: ${command}`));
		});

		render(<SettingsPage />);
		const removeButton = await screen.findByRole("button", {
			name: "Remove legacy API key",
		});
		fireEvent.click(removeButton);

		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith("delete_legacy_api_key"),
		);
		expect(await screen.findByText("No legacy receipt API key is stored.")).toBeVisible();
		expect(screen.queryByText(/sk-ant-/i)).not.toBeInTheDocument();
	});

	it("reports when there is no legacy credential to clean up", async () => {
		invoke.mockResolvedValue(false);

		render(<SettingsPage />);

		expect(await screen.findByText("No legacy receipt API key is stored.")).toBeVisible();
		expect(invoke).toHaveBeenCalledWith("has_legacy_api_key");
	});
});
