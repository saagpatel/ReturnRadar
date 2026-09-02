import {
	LayoutDashboard,
	Moon,
	Receipt,
	ScanSearch,
	Settings,
	Shield,
	ShoppingBag,
	Sun,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

const mainNavItems = [
	{ to: "/", icon: LayoutDashboard, label: "Dashboard" },
	{ to: "/purchases", icon: ShoppingBag, label: "Purchases" },
	{ to: "/rebates", icon: Receipt, label: "Rebates" },
	{ to: "/warranties", icon: Shield, label: "Warranties" },
	{ to: "/captured-deadlines", icon: ScanSearch, label: "Captured" },
] as const;

function NavItem({
	to,
	icon: Icon,
	label,
	end,
}: {
	to: string;
	icon: typeof LayoutDashboard;
	label: string;
	end?: boolean;
}) {
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				cn(
					"flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors duration-150",
					isActive
						? "bg-accent font-medium text-accent-foreground"
						: "font-normal text-muted-foreground hover:bg-accent/50 hover:text-foreground",
				)
			}
		>
			<Icon className="size-4" />
			{label}
		</NavLink>
	);
}

export function Sidebar() {
	const { settings, updateSetting } = useSettings();

	function toggleTheme() {
		const next = settings.theme === "dark" ? "light" : "dark";
		updateSetting("theme", next).catch(console.error);
	}

	return (
		<aside className="flex h-screen w-56 flex-col border-r bg-sidebar">
			<div className="flex h-14 items-center px-4">
				<h1 className="text-lg font-bold tracking-tight text-sidebar-foreground">
					Return Radar
				</h1>
			</div>
			<Separator />
			<nav className="flex flex-1 flex-col gap-1 p-3">
				{mainNavItems.map((item) => (
					<NavItem
						key={item.to}
						to={item.to}
						icon={item.icon}
						label={item.label}
						end={item.to === "/"}
					/>
				))}

				<div className="mt-auto">
					<Separator className="mb-3" />
					<NavItem to="/settings" icon={Settings} label="Settings" />
				</div>
			</nav>
			<div className="flex items-center justify-between px-4 py-3">
				<span className="text-xs text-muted-foreground">
					v0.1.0 · All data local
				</span>
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={toggleTheme}
					className="text-muted-foreground hover:text-foreground"
				>
					{settings.theme === "dark" ? (
						<Sun className="size-3.5" />
					) : (
						<Moon className="size-3.5" />
					)}
					<span className="sr-only">Toggle theme</span>
				</Button>
			</div>
		</aside>
	);
}
