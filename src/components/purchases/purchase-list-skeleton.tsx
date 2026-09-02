import { Skeleton } from "@/components/ui/skeleton";

export function PurchaseListSkeleton() {
	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<Skeleton className="h-9 w-36" />
				<Skeleton className="h-9 w-32 rounded-md" />
			</div>
			<div className="rounded-md border">
				<div className="border-b px-4 py-3">
					<div className="flex items-center gap-6">
						{[40, 24, 20, 20, 16, 16, 16].map((w, i) => (
							<Skeleton
								key={i}
								className="h-4 rounded"
								style={{ width: `${w * 4}px` }}
							/>
						))}
					</div>
				</div>
				{Array.from({ length: 5 }).map((_, i) => (
					<div
						key={i}
						className="flex items-center gap-6 border-b px-4 py-3.5 last:border-b-0"
					>
						<Skeleton className="h-4 w-40" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-5 w-16 rounded-full" />
						<Skeleton className="ml-auto h-4 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}
