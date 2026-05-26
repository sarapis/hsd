'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface OrgSearchProps {
    initialQuery?: string;
}

/**
 * Client-side search input for the groups page.
 * Submitting navigates to /organizations?q=... which triggers
 * a server-side re-fetch with the search parameter.
 */
export function OrgSearch({ initialQuery = '' }: OrgSearchProps) {
    const [query, setQuery] = useState(initialQuery);
    const router = useRouter();

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            router.push(`/organizations?q=${encodeURIComponent(query.trim())}`);
        } else {
            router.push('/organizations');
        }
    };

    const handleClear = () => {
        setQuery('');
        router.push('/organizations');
    };

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-xl">
            <label htmlFor="org-search" className="sr-only">
                Search groups
            </label>
            <div className="relative flex items-center">
                <svg className="absolute left-3 w-5 h-5 text-[var(--muted)]" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    id="org-search"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search groups by name..."
                    className="w-full pl-10 pr-24 py-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                />
                <div className="absolute right-2 flex items-center gap-1">
                    {query && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
                            aria-label="Clear search"
                        >
                            <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                    <button
                        type="submit"
                        className="px-4 py-1.5 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] transition-colors"
                    >
                        Search
                    </button>
                </div>
            </div>
        </form>
    );
}
