import Link from 'next/link';

/**
 * Custom 404 Not Found page.
 */
export default function NotFound() {
    return (
        <div className="container mx-auto px-4 py-16">
            <div className="max-w-md mx-auto text-center">
                {/* Icon */}
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[var(--section-alt)] mb-6">
                    <svg className="w-10 h-10 text-[var(--muted)]" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>

                {/* Title */}
                <h1 className="font-display text-4xl font-bold text-[var(--foreground)] mb-4">
                    404 - Page Not Found
                </h1>

                {/* Description */}
                <p className="text-[var(--muted)] mb-8">
                    Sorry, we couldn&apos;t find the page you&apos;re looking for.
                    It may have been moved or deleted.
                </p>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center px-6 py-3 rounded-xl 
              border border-[var(--card-border)] text-[var(--foreground)] opacity-70
              hover:bg-[var(--section-alt)] hover:opacity-100 transition-all"
                    >
                        Back To Homepage
                    </Link>
                    <Link
                        href="/services"
                        className="inline-flex items-center justify-center px-6 py-3 rounded-xl 
              border border-[var(--card-border)] text-[var(--foreground)] opacity-70
              hover:bg-[var(--section-alt)] hover:opacity-100 transition-all"
                    >
                        Browse Resources
                    </Link>
                </div>
            </div>
        </div>
    );
}
