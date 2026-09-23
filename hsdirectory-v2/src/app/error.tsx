'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Shown when a page's data fetch fails and there is no previously cached
 * render to fall back on. Says plainly that the directory is unavailable,
 * rather than rendering zero counts that read as an empty directory.
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Page failed to load:', error);
    }, [error]);

    return (
        <div className="container mx-auto px-4 py-24">
            <div className="max-w-xl mx-auto text-center">
                <h1 className="font-display text-3xl font-bold text-[var(--secondary)] mb-4">
                    The directory is temporarily unavailable
                </h1>
                <p className="text-[var(--muted)] mb-8">
                    We couldn&apos;t load resources just now. This is on our side, not yours —
                    please try again in a moment.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                        onClick={reset}
                        className="px-5 py-2.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium transition-colors"
                    >
                        Try again
                    </button>
                    <Link
                        href="/"
                        className="px-5 py-2.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] font-medium hover:bg-[var(--section-alt)] transition-colors"
                    >
                        Go to homepage
                    </Link>
                </div>
            </div>
        </div>
    );
}
