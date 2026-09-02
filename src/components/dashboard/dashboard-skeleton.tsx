import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
	return (
		<div className="space-y-8">
			<Skeleton className="h-9 w-40" />
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<Card key={i}>
						<CardHeader className="pb-2">
							<Skeleton className="h-4 w-24" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-8 w-16" />
							<Skeleton className="mt-2 h-3 w-32" />
						</CardContent>
					</Card>
				))}
			</div>
			<Skeleton className="h-6 w-32" />
			<div className="space-y-2">
				{Array.from({ length: 3 }).map((_, i) => (
					<Skeleton key={i} className="h-16 w-full rounded-lg" />
				))}
			</div>
		</div>
	);
}
