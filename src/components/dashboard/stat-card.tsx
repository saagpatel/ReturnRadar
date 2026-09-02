import type { LucideIcon } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
	title: string;
	value: string | number;
	description?: string;
	icon: LucideIcon;
	variant?: "default" | "warning" | "danger";
}

export function StatCard({
	title,
	value,
	description,
	icon: Icon,
	variant = "default",
}: StatCardProps) {
	return (
		<Card
			className={cn(
				"transition-shadow duration-150 hover:shadow-md",
				variant === "warning" && "border-l-4 border-l-amber-400",
				variant === "danger" && "border-l-4 border-l-red-400",
			)}
		>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				<Icon
					className={cn(
						"size-4",
						variant === "warning"
							? "text-amber-500"
							: variant === "danger"
								? "text-red-500"
								: "text-muted-foreground",
					)}
				/>
			</CardHeader>
			<CardContent>
				<div className="text-3xl font-extrabold">{value}</div>
				{description && (
					<CardDescription className="mt-1">{description}</CardDescription>
				)}
			</CardContent>
		</Card>
	);
}
