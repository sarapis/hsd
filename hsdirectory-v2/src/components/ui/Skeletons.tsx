/**
 * Skeleton loading component for service cards.
 */
export function ServiceCardSkeleton() {
    return (
        <div className="animate-pulse rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    {/* Title */}
                    <div className="h-6 bg-[var(--card-border)] rounded w-3/4 mb-3" />
                    {/* Organization */}
                    <div className="h-4 bg-[var(--section-alt)] rounded w-1/2 mb-4" />
                    {/* Description */}
                    <div className="space-y-2">
                        <div className="h-4 bg-[var(--section-alt)] rounded w-full" />
                        <div className="h-4 bg-[var(--section-alt)] rounded w-5/6" />
                    </div>
                </div>
                {/* Status badge */}
                <div className="h-6 w-16 bg-[var(--section-alt)] rounded-full" />
            </div>
        </div>
    );
}

/**
 * Skeleton loading component for organization cards.
 */
export function OrganizationCardSkeleton() {
    return (
        <div className="animate-pulse rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
            <div className="flex items-start gap-4">
                {/* Logo placeholder */}
                <div className="h-12 w-12 bg-[var(--card-border)] rounded-lg shrink-0" />
                <div className="flex-1">
                    {/* Title */}
                    <div className="h-6 bg-[var(--card-border)] rounded w-2/3 mb-3" />
                    {/* Description */}
                    <div className="space-y-2">
                        <div className="h-4 bg-[var(--section-alt)] rounded w-full" />
                        <div className="h-4 bg-[var(--section-alt)] rounded w-4/5" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Grid of skeleton cards for loading states.
 */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: count }).map((_, i) => (
                <ServiceCardSkeleton key={i} />
            ))}
        </div>
    );
}
