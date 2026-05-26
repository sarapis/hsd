import Link from 'next/link';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    baseUrl: string;
}

/**
 * Pagination component for navigating through paginated results.
 */
export function Pagination({ currentPage, totalPages, baseUrl }: PaginationProps) {
    if (totalPages <= 1) return null;

    // Generate page numbers to show
    const getPageNumbers = () => {
        const pages: (number | 'ellipsis')[] = [];
        const showEllipsis = totalPages > 7;

        if (!showEllipsis) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }

        // Always show first page
        pages.push(1);

        if (currentPage > 3) {
            pages.push('ellipsis');
        }

        // Show pages around current
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
            pages.push(i);
        }

        if (currentPage < totalPages - 2) {
            pages.push('ellipsis');
        }

        // Always show last page
        if (totalPages > 1) {
            pages.push(totalPages);
        }

        return pages;
    };

    const buildUrl = (page: number) => {
        const url = new URL(baseUrl, 'http://localhost');
        url.searchParams.set('page', String(page));
        return `${url.pathname}${url.search}`;
    };

    return (
        <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
            {/* Previous */}
            {currentPage > 1 ? (
                <Link
                    href={buildUrl(currentPage - 1)}
                    className="flex h-10 items-center justify-center rounded-lg px-3 text-sm font-medium 
            text-[var(--foreground)] opacity-70 hover:bg-[var(--section-alt)] hover:opacity-100"
                >
                    Previous
                </Link>
            ) : (
                <span className="flex h-10 items-center justify-center rounded-lg px-3 text-sm font-medium 
          text-[var(--muted)] opacity-40 cursor-not-allowed">
                    Previous
                </span>
            )}

            {/* Page Numbers */}
            <div className="flex items-center gap-1">
                {getPageNumbers().map((page, idx) =>
                    page === 'ellipsis' ? (
                        <span key={`ellipsis-${idx}`} className="px-2 text-[var(--muted)]">...</span>
                    ) : (
                        <Link
                            key={page}
                            href={buildUrl(page)}
                            className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium transition-colors
                ${currentPage === page
                                    ? 'bg-[var(--primary)] text-white'
                                    : 'text-[var(--foreground)] opacity-70 hover:bg-[var(--section-alt)] hover:opacity-100'
                                }`}
                        >
                            {page}
                        </Link>
                    )
                )}
            </div>

            {/* Next */}
            {currentPage < totalPages ? (
                <Link
                    href={buildUrl(currentPage + 1)}
                    className="flex h-10 items-center justify-center rounded-lg px-3 text-sm font-medium 
            text-[var(--foreground)] opacity-70 hover:bg-[var(--section-alt)] hover:opacity-100"
                >
                    Next
                </Link>
            ) : (
                <span className="flex h-10 items-center justify-center rounded-lg px-3 text-sm font-medium 
          text-[var(--muted)] opacity-40 cursor-not-allowed">
                    Next
                </span>
            )}
        </nav>
    );
}
