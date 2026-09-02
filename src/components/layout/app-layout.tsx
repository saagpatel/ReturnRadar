import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";

export function AppLayout() {
	return (
		<div className="flex h-screen">
			<Sidebar />
			<main className="flex-1 overflow-y-auto px-8 py-8">
				<div className="mx-auto max-w-5xl">
					<Outlet />
				</div>
			</main>
		</div>
	);
}
