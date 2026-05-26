'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface SearchBarProps {
    initialQuery?: string;
    size?: 'sm' | 'lg';
    placeholder?: string;
}

/**
 * Reusable search bar with optional geolocation.
 * The location pin icon requests browser geolocation and passes
 * lat/lng to the map page so proximity sorting activates automatically.
 */
export function SearchBar({
    initialQuery = '',
    size = 'lg',
    placeholder = 'Search for services...'
}: SearchBarProps) {
    const [query, setQuery] = useState(initialQuery);
    const [locating, setLocating] = useState(false);
    const router = useRouter();

    /** Build the /services URL with current query and optional lat/lng. */
    const buildUrl = (q: string, coords?: { lat: number; lng: number }) => {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (coords) {
            params.set('lat', coords.lat.toFixed(6));
            params.set('lng', coords.lng.toFixed(6));
        }
        const qs = params.toString();
        return qs ? `/services?${qs}` : '/services';
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        router.push(buildUrl(query));
    };

    /** Get geolocation then navigate to map with lat/lng in URL. */
    const handleLocationSearch = () => {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                router.push(buildUrl(query, {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                }));
            },
            () => setLocating(false),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    const inputClasses = size === 'lg'
        ? 'h-14 text-lg pl-6 pr-28'
        : 'h-10 text-sm pl-4 pr-24';

    const btnPadding = size === 'lg' ? 'px-5 py-2' : 'px-3 py-1.5 text-sm';

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-2xl">
            <div className="relative flex items-center">
                <label htmlFor="search-input" className="sr-only">
                    {placeholder}
                </label>
                <input
                    id="search-input"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    className={`w-full rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm 
            focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20
            text-[var(--foreground)] placeholder:text-[var(--muted)]
            ${inputClasses}`}
                />
                <div className="absolute right-2 flex items-center gap-1">
                    <button
                        type="button"
                        onClick={handleLocationSearch}
                        disabled={locating}
                        title="Search near my location"
                        className={`rounded-full p-2 text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--tag-coral-bg)] transition-colors disabled:opacity-50 ${locating ? 'animate-pulse' : ''}`}
                    >
                        <svg className="w-5 h-5" aria-label="search by location" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                    <button
                        type="submit"
                        className={`rounded-full bg-[var(--primary)] text-white 
            hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]
            transition-colors ${btnPadding}`}
                    >
                        Search
                    </button>
                </div>
            </div>
        </form>
    );
}
