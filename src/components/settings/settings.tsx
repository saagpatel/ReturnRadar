import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

export function SettingsPage() {
	const { settings, loading, updateSetting } = useSettings();
	const [returnDays, setReturnDays] = useState<string>("");
	const [initialized, setInitialized] = useState(false);
	const [legacyKeyState, setLegacyKeyState] = useState<
		"loading" | "present" | "absent" | "error"
	>("loading");
	const [legacyKeyDeleting, setLegacyKeyDeleting] = useState(false);

	// Initialize local state from loaded settings (once)
	if (!loading && !initialized) {
		setReturnDays(String(settings.defaultReturnDays));
		setInitialized(true);
	}

	useEffect(() => {
		invoke<boolean>("has_legacy_api_key")
			.then((present) => setLegacyKeyState(present ? "present" : "absent"))
			.catch((error: unknown) => {
				console.error("Legacy Keychain check failed:", error);
				setLegacyKeyState("error");
			});
	}, []);

	if (loading) {
		return (
			<div className="space-y-8">
				<div className="h-9 w-28 animate-pulse rounded bg-muted" />
				<div className="h-40 animate-pulse rounded-lg bg-muted" />
				<div className="h-56 animate-pulse rounded-lg bg-muted" />
			</div>
		);
	}

	function handleReturnDaysBlur() {
		const days = Number(returnDays);
		if (!Number.isNaN(days) && days > 0) {
			updateSetting("default_return_days", String(days)).catch(console.error);
		}
	}

	function handleReturnDaysKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter") {
			handleReturnDaysBlur();
		}
	}

	async function handleDeleteLegacyApiKey() {
		setLegacyKeyDeleting(true);
		try {
			await invoke("delete_legacy_api_key");
			setLegacyKeyState("absent");
		} catch (error: unknown) {
			console.error("Legacy Keychain cleanup failed:", error);
			setLegacyKeyState("error");
		} finally {
			setLegacyKeyDeleting(false);
		}
	}

	return (
		<div className="space-y-8">
			<h2 className="text-3xl font-extrabold tracking-tight">Settings</h2>

			<Card>
				<CardHeader>
					<CardTitle>Appearance</CardTitle>
					<CardDescription>Choose your preferred color scheme.</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2">
						{(["light", "dark", "system"] as const).map((t) => (
							<Button
								key={t}
								variant={settings.theme === t ? "default" : "outline"}
								size="sm"
								onClick={() => updateSetting("theme", t).catch(console.error)}
							>
								{t.charAt(0).toUpperCase() + t.slice(1)}
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Return Window Defaults</CardTitle>
					<CardDescription>
						Set the default return window for purchases from unlisted retailers.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-4">
						<Label htmlFor="default-return-days" className="shrink-0">
							Default return window
						</Label>
						<Input
							id="default-return-days"
							type="number"
							min={1}
							className="w-24"
							value={returnDays}
							onChange={(e) => setReturnDays(e.target.value)}
							onBlur={handleReturnDaysBlur}
							onKeyDown={handleReturnDaysKeyDown}
						/>
						<span className="text-sm text-muted-foreground">days</span>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Notifications</CardTitle>
					<CardDescription>
						Control when Return Radar sends deadline reminders.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="notify-7day">7-day reminder</Label>
							<p className="text-sm text-muted-foreground">
								Get notified 7 days before a return or rebate deadline
							</p>
						</div>
						<Switch
							id="notify-7day"
							checked={settings.notify7day}
							onCheckedChange={(checked) =>
								updateSetting("notify_7day", checked ? "true" : "false").catch(
									console.error,
								)
							}
						/>
					</div>

					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="notify-1day">1-day reminder</Label>
							<p className="text-sm text-muted-foreground">
								Get notified the day before a return or rebate deadline
							</p>
						</div>
						<Switch
							id="notify-1day"
							checked={settings.notify1day}
							onCheckedChange={(checked) =>
								updateSetting("notify_1day", checked ? "true" : "false").catch(
									console.error,
								)
							}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Receipt and policy capture</CardTitle>
					<CardDescription>
						Selected images are read with macOS Vision and text PDFs with PDFKit.
						Documents stay on this Mac and no API key is required.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm text-muted-foreground">
					<p>Raw document bytes and full OCR text are discarded after review.</p>
					<p>Only a fingerprint, generic source label, redacted evidence, and your corrections are stored with confirmed deadlines.</p>
					<div className="space-y-2 border-t pt-4" aria-live="polite">
						<p className="font-medium text-foreground">Legacy receipt API key</p>
						{legacyKeyState === "loading" ? (
							<p>Checking this Mac's Keychain…</p>
						) : legacyKeyState === "present" ? (
							<div className="flex flex-wrap items-center gap-3">
								<p>An API key from an earlier Return Radar version is still stored locally.</p>
								<Button
									variant="outline"
									size="sm"
									disabled={legacyKeyDeleting}
									onClick={() => handleDeleteLegacyApiKey().catch(console.error)}
								>
									{legacyKeyDeleting ? "Removing…" : "Remove legacy API key"}
								</Button>
							</div>
						) : legacyKeyState === "absent" ? (
							<p>No legacy receipt API key is stored.</p>
						) : (
							<p>Return Radar could not inspect or remove the legacy Keychain item.</p>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>About</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm text-muted-foreground">
					<p>
						<span className="font-medium text-foreground">Return Radar</span>{" "}
						v0.1.0
					</p>
					<p>
						All data is stored locally on your Mac. Nothing leaves this device.
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
