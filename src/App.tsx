import { invoke } from "@tauri-apps/api/core";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Dashboard } from "@/components/dashboard/dashboard";
import { AppLayout } from "@/components/layout/app-layout";
import { AddPurchaseModal } from "@/components/purchases/add-purchase-modal";
import { PurchaseList } from "@/components/purchases/purchase-list";
import { AddRebateModal } from "@/components/rebates/add-rebate-modal";
import { RebateList } from "@/components/rebates/rebate-list";
import { SettingsPage } from "@/components/settings/settings";
import { AddWarrantyModal } from "@/components/warranties/add-warranty-modal";
import { WarrantyList } from "@/components/warranties/warranty-list";
import { PurchaseProvider, usePurchaseContext } from "@/hooks/use-purchases";
import { RebateProvider, useRebateContext } from "@/hooks/use-rebates";
import { useWarrantyContext, WarrantyProvider } from "@/hooks/use-warranties";
import { getDb } from "@/lib/db";
import { shouldHandleGlobalShortcut } from "@/lib/keyboard-shortcuts";
import {
	checkAndFireDeadlineNotifications,
	requestNotificationPermissionIfNeeded,
} from "@/lib/notifications";

const ImportReceiptModal = lazy(() =>
	import("@/components/receipts/import-receipt-modal").then((module) => ({
		default: module.ImportReceiptModal,
	})),
);
const CapturedDeadlineList = lazy(() =>
	import("@/components/receipts/captured-deadline-list").then((module) => ({
		default: module.CapturedDeadlineList,
	})),
);

function CaptureLoadingState() {
	return (
		<div className="rounded-lg border p-8 text-center text-sm text-muted-foreground" aria-live="polite">
			Loading local capture…
		</div>
	);
}

function AppRoutes() {
	const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
	const [rebateModalOpen, setRebateModalOpen] = useState(false);
	const [importModalOpen, setImportModalOpen] = useState(false);
	const [warrantyModalOpen, setWarrantyModalOpen] = useState(false);
	const [captureVersion, setCaptureVersion] = useState(0);
	const { refetch: refetchPurchases } = usePurchaseContext();
	const { refetch: refetchRebates } = useRebateContext();
	const { refetch: refetchWarranties } = useWarrantyContext();

	const navigate = useNavigate();

	// Global keyboard shortcuts
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const modalOpen =
				purchaseModalOpen || rebateModalOpen || importModalOpen || warrantyModalOpen;
			if (!shouldHandleGlobalShortcut(e, modalOpen)) return;

			switch (e.key) {
				case "n":
					e.preventDefault();
					setPurchaseModalOpen(true);
					break;
				case ",":
					e.preventDefault();
					navigate("/settings");
					break;
				case "1":
					e.preventDefault();
					navigate("/");
					break;
				case "2":
					e.preventDefault();
					navigate("/purchases");
					break;
				case "3":
					e.preventDefault();
					navigate("/rebates");
					break;
				case "4":
					e.preventDefault();
					navigate("/warranties");
					break;
				case "i":
					e.preventDefault();
					setImportModalOpen(true);
					break;
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		importModalOpen,
		navigate,
		purchaseModalOpen,
		rebateModalOpen,
		warrantyModalOpen,
	]);

	const handleCaptured = useCallback(() => {
		setCaptureVersion((version) => version + 1);
		navigate("/captured-deadlines");
	}, [navigate]);

	const handleWarrantySaved = useCallback(() => {
		refetchWarranties().catch(console.error);
	}, [refetchWarranties]);

	const handlePurchaseSaved = useCallback(() => {
		refetchPurchases().catch(console.error);
	}, [refetchPurchases]);

	const handleRebateSaved = useCallback(() => {
		refetchRebates().catch(console.error);
	}, [refetchRebates]);

	return (
		<>
			<Routes>
				<Route element={<AppLayout />}>
					<Route index element={<Dashboard />} />
					<Route
						path="purchases"
						element={
							<PurchaseList
								onOpenModal={() => setPurchaseModalOpen(true)}
								onOpenImport={() => setImportModalOpen(true)}
							/>
						}
					/>
					<Route
						path="rebates"
						element={
							<RebateList onOpenModal={() => setRebateModalOpen(true)} />
						}
					/>
					<Route
						path="warranties"
						element={
							<WarrantyList onOpenModal={() => setWarrantyModalOpen(true)} />
						}
					/>
					<Route path="settings" element={<SettingsPage />} />
					<Route
						path="captured-deadlines"
						element={
							<Suspense fallback={<CaptureLoadingState />}>
								<CapturedDeadlineList
									onOpenCapture={() => setImportModalOpen(true)}
									refreshToken={captureVersion}
								/>
							</Suspense>
						}
					/>
				</Route>
			</Routes>
			<AddPurchaseModal
				open={purchaseModalOpen}
				onOpenChange={setPurchaseModalOpen}
				onSaved={handlePurchaseSaved}
			/>
			<AddRebateModal
				open={rebateModalOpen}
				onOpenChange={setRebateModalOpen}
				onSaved={handleRebateSaved}
			/>
			{importModalOpen ? (
				<Suspense fallback={null}>
					<ImportReceiptModal
						open={importModalOpen}
						onOpenChange={setImportModalOpen}
						onCaptured={handleCaptured}
					/>
				</Suspense>
			) : null}
			<AddWarrantyModal
				open={warrantyModalOpen}
				onOpenChange={setWarrantyModalOpen}
				onSaved={handleWarrantySaved}
			/>
		</>
	);
}

function App() {
	const [dbReady, setDbReady] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function init() {
			await getDb();
			setDbReady(true);

			// Notification setup (non-blocking — failures don't prevent app use)
			if (import.meta.env.VITE_RETURNRADAR_DISABLE_NOTIFICATIONS !== "true") {
				try {
					const notificationSetupAllowed = await invoke<boolean>(
						"notification_setup_allowed",
					);
					if (notificationSetupAllowed) {
						await requestNotificationPermissionIfNeeded();
						await checkAndFireDeadlineNotifications();
						await invoke("install_launchd_agent");
					}
				} catch (err: unknown) {
					console.warn("Notification setup issue:", err);
				}
			}
		}

		init().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			console.error("DB init failed:", message);
		});
	}, []);

	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<p className="text-destructive">Database error: {error}</p>
			</div>
		);
	}

	if (!dbReady) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<BrowserRouter>
			<PurchaseProvider>
				<RebateProvider>
					<WarrantyProvider>
						<AppRoutes />
					</WarrantyProvider>
				</RebateProvider>
			</PurchaseProvider>
		</BrowserRouter>
	);
}

export default App;
