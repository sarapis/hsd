'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { TagLink } from '@/components/ui/TagLink';

/** NYC boroughs and the city names that map to them in address data. */
const BOROUGH_MAP: Record<string, string[]> = {
    'Manhattan': ['New York', 'Manhattan'],
    'Brooklyn': ['Brooklyn'],
    'Bronx': ['Bronx', 'The Bronx'],
    'Queens': ['Queens'],
    'Staten Island': ['Staten Island'],
};
const BOROUGHS = Object.keys(BOROUGH_MAP);

/** Extract the city/borough from a formatted address string ("street, city, state, zip"). */
function extractBorough(address?: string): string | null {
    if (!address) return null;
    const parts = address.split(',').map(p => p.trim());
    if (parts.length < 2) return null;
    const city = parts[1];
    for (const [borough, cities] of Object.entries(BOROUGH_MAP)) {
        if (cities.some(c => c.toLowerCase() === city.toLowerCase())) return borough;
    }
    return null;
}

/** Haversine distance in miles between two lat/lng points. */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Service {
    id: string;
    name: string;
    description?: string;
    address?: string;
    phone?: string;
    url?: string;
    needFocus?: string[];
    communityFocus?: string[];
    latitude?: number;
    longitude?: number;
}

interface Category {
    name: string;
    icon?: string;
}

interface MapPageClientProps {
    services: Service[];
    needCategories: Category[];
    communityCategories: Category[];
}

/**
 * Client component for interactive map page with URL-synced filters.
 *
 * Reads initial filter state from URL query params (?category=, ?community=)
 * and pushes URL updates when the user changes filters, enabling sharable
 * filtered views like /services?category=Housing.
 */
export default function MapPageClient({
    services,
    needCategories,
    communityCategories
}: MapPageClientProps) {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Initialize state from URL query params
    const [searchQuery, setSearchQuery] = useState<string>(
        searchParams.get('q') || ''
    );
    const [selectedNeed, setSelectedNeed] = useState<string>(
        searchParams.get('category') || ''
    );
    const [selectedCommunity, setSelectedCommunity] = useState<string>(
        searchParams.get('community') || ''
    );
    const [selectedBorough, setSelectedBorough] = useState<string>(
        searchParams.get('borough') || ''
    );

    // Initialize user location from URL params (set by SearchBar location button)
    const initLat = searchParams.get('lat');
    const initLng = searchParams.get('lng');
    const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
        (initLat && initLng) ? { lat: parseFloat(initLat), lng: parseFloat(initLng) } : null
    );
    const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [hoveredServiceId, setHoveredServiceId] = useState<string | null>(null);

    // Responsive state
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'map' | 'list'>('list');

    // Sync state when URL params change (e.g. header SearchBar navigation)
    useEffect(() => {
        setSearchQuery(searchParams.get('q') || '');
        setSelectedNeed(searchParams.get('category') || '');
        setSelectedCommunity(searchParams.get('community') || '');
        setSelectedBorough(searchParams.get('borough') || '');
        const lat = searchParams.get('lat');
        const lng = searchParams.get('lng');
        if (lat && lng) {
            setUserLocation({ lat: parseFloat(lat), lng: parseFloat(lng) });
        }
    }, [searchParams]);

    /**
     * Push filter state into the browser URL so that filtered views are
     * bookmarkable and sharable (e.g. /services?category=Housing&q=food&borough=Brooklyn).
     */
    const syncUrl = useCallback((query: string, need: string, community: string, borough: string) => {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (need) params.set('category', need);
        if (community) params.set('community', community);
        if (borough) params.set('borough', borough);
        const qs = params.toString();
        router.replace(qs ? `/services?${qs}` : '/services', { scroll: false });
    }, [router]);

    // Handle search submit
    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        syncUrl(searchQuery, selectedNeed, selectedCommunity, selectedBorough);
    };

    // Handle need category change
    const handleNeedChange = (value: string) => {
        setSelectedNeed(value);
        syncUrl(searchQuery, value, selectedCommunity, selectedBorough);
    };

    // Handle community focus change
    const handleCommunityChange = (value: string) => {
        setSelectedCommunity(value);
        syncUrl(searchQuery, selectedNeed, value, selectedBorough);
    };

    // Handle borough change
    const handleBoroughChange = (value: string) => {
        setSelectedBorough(value);
        syncUrl(searchQuery, selectedNeed, selectedCommunity, value);
    };

    // Request browser geolocation
    const handleUseLocation = () => {
        if (!navigator.geolocation) {
            setLocationStatus('error');
            return;
        }
        setLocationStatus('loading');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocationStatus('idle');
            },
            () => setLocationStatus('error'),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    const handleClearLocation = () => {
        setUserLocation(null);
        setLocationStatus('idle');
    };

    // Clear all filters
    const handleClearFilters = () => {
        setSearchQuery('');
        setSelectedNeed('');
        setSelectedCommunity('');
        setSelectedBorough('');
        setUserLocation(null);
        setLocationStatus('idle');
        syncUrl('', '', '', '');
    };

    // Filter and rank resources by relevance.
    // Each search token earns points based on which field it matches:
    //   Name match = 4pts, Tag match = 3pts, Address = 2pts, Description = 1pt.
    // Results are sorted by total score (highest first).
    const filteredServices = useMemo(() => {
        const STOP_WORDS = new Set(['in', 'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'at', 'on', 'near', 'by', 'with']);
        const tokens = searchQuery
            .toLowerCase()
            .split(/\s+/)
            .filter(t => t.length > 0 && !STOP_WORDS.has(t));

        const scored = services.map(service => {
            // Apply dropdown filters first (pass/fail)
            if (selectedNeed && !service.needFocus?.includes(selectedNeed)) return null;
            if (selectedCommunity && !service.communityFocus?.includes(selectedCommunity)) return null;
            if (selectedBorough && extractBorough(service.address) !== selectedBorough) return null;

            if (tokens.length === 0) return { service, score: 0 };

            const nameLower = (service.name || '').toLowerCase();
            const descLower = (service.description || '').toLowerCase();
            const addrLower = (service.address || '').toLowerCase();
            const tagsLower = [
                ...(service.needFocus || []),
                ...(service.communityFocus || []),
            ].join(' ').toLowerCase();
            const allText = `${nameLower} ${descLower} ${addrLower} ${tagsLower}`;

            // Every token must appear somewhere (AND logic)
            if (!tokens.every(t => allText.includes(t))) return null;

            // Score each token by best field match
            let score = 0;
            for (const token of tokens) {
                if (nameLower.includes(token)) score += 4;
                else if (tagsLower.includes(token)) score += 3;
                else if (addrLower.includes(token)) score += 2;
                else if (descLower.includes(token)) score += 1;
            }
            return { service, score };
        });

        const results = scored
            .filter((s): s is { service: Service; score: number } => s !== null);

        // Sort by distance if location is active, otherwise by relevance score
        if (userLocation) {
            results.sort((a, b) => {
                const distA = (a.service.latitude && a.service.longitude)
                    ? haversineDistance(userLocation.lat, userLocation.lng, a.service.latitude, a.service.longitude)
                    : Infinity;
                const distB = (b.service.latitude && b.service.longitude)
                    ? haversineDistance(userLocation.lat, userLocation.lng, b.service.latitude, b.service.longitude)
                    : Infinity;
                if (distA !== distB) return distA - distB;
                return b.score - a.score; // tie-break by relevance
            });
        } else {
            results.sort((a, b) => b.score - a.score);
        }

        return results.map(s => s.service);
    }, [services, searchQuery, selectedNeed, selectedCommunity, selectedBorough, userLocation]);

    // Get locations for map
    const mapLocations = useMemo(() => {
        const locations = filteredServices
            .filter(s => s.latitude && s.longitude)
            .map(s => ({
                id: s.id,
                name: s.name,
                latitude: s.latitude!,
                longitude: s.longitude!,
                serviceName: s.name,
                serviceId: s.id,
                orgName: (s as any).organization_name,
            }));
            
        // Add jitter for overlapping coordinates (exact matches)
        const locationMap = new Map<string, number>();
        const jitterDegrees = 0.00005; // ~5 meters
        
        return locations.map(loc => {
            const key = `${loc.latitude},${loc.longitude}`;
            const count = locationMap.get(key) || 0;
            locationMap.set(key, count + 1);
            
            if (count > 0) {
                // Apply a spiral or simple offset based on index to separate them visually
                const angle = count * Math.PI / 4; // Spread them around
                const radius = jitterDegrees * Math.ceil(count / 8);
                return {
                    ...loc,
                    latitude: loc.latitude + Math.sin(angle) * radius,
                    longitude: loc.longitude + Math.cos(angle) * radius,
                };
            }
            return loc;
        });
    }, [filteredServices]);

    return (
        <div className="flex flex-col md:flex-row h-[calc(100vh-64px)] overflow-hidden">
            {/* Mobile Action Bar */}
            <div className="md:hidden flex items-center justify-between p-3 bg-[var(--section-alt)] border-b border-[var(--card-border)] flex-shrink-0 z-10 w-full shadow-sm">
                <button 
                    onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-medium text-[var(--foreground)]"
                >
                    <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    {isFiltersOpen ? 'Hide Filters' : 'Filters'}
                    {(searchQuery || selectedNeed || selectedCommunity || selectedBorough) && (
                        <span className="w-2 h-2 rounded-full bg-[var(--highlight)] flex-shrink-0"></span>
                    )}
                </button>

                <div className="flex items-center bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-0.5">
                    <button 
                        onClick={() => setViewMode('list')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'list' ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
                    >
                        List
                    </button>
                    <button 
                        onClick={() => setViewMode('map')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'map' ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
                    >
                        Map
                    </button>
                </div>
            </div>

            {/* Left Column: Filters */}
            <div className={`${isFiltersOpen ? 'block' : 'hidden'} md:block w-full md:w-64 flex-shrink-0 bg-[var(--section-alt)] md:border-r border-b md:border-b-0 border-[var(--card-border)] p-4 overflow-y-auto scrollbar-thin`}>
                <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
                    Filters
                </h2>

                {/* Search Input */}
                <div className="mb-6">
                    <label htmlFor="search-resources" className="block text-sm font-medium text-[var(--foreground)] opacity-80 mb-2">
                        Search
                    </label>
                    <form onSubmit={handleSearchSubmit}>
                        <input
                            id="search-resources"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                syncUrl(e.target.value, selectedNeed, selectedCommunity, selectedBorough);
                            }}
                            placeholder="Search resources..."
                            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                        />
                    </form>
                </div>

                {/* Use My Location */}
                <div className="mb-6">
                    {!userLocation ? (
                        <button
                            onClick={handleUseLocation}
                            disabled={locationStatus === 'loading'}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] hover:bg-[var(--section-alt)] transition-colors disabled:opacity-50"
                        >
                            <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {locationStatus === 'loading' ? 'Locating...' : 'Use My Location'}
                        </button>
                    ) : (
                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--tag-olive-bg)] border border-[var(--secondary)]/30">
                            <span className="text-sm text-[var(--tag-olive-text)] font-medium">📍 Sorting by distance</span>
                            <button
                                onClick={handleClearLocation}
                                className="text-xs text-[var(--tag-olive-text)] hover:opacity-70"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                    {locationStatus === 'error' && (
                        <p className="text-xs text-red-500 mt-1">Location access denied or unavailable.</p>
                    )}
                </div>

                {/* Need Category Filter */}
                <div className="mb-6">
                    <label htmlFor="filter-need" className="block text-sm font-medium text-[var(--foreground)] opacity-80 mb-2">
                        Need Category
                    </label>
                    <select
                        id="filter-need"
                        value={selectedNeed}
                        onChange={(e) => handleNeedChange(e.target.value)}
                        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                    >
                        <option value="">All Categories</option>
                        {needCategories.map(cat => (
                            <option key={cat.name} value={cat.name}>{cat.name}</option>
                        ))}
                    </select>
                </div>

                {/* Community Focus Filter */}
                <div className="mb-6">
                    <label htmlFor="filter-community" className="block text-sm font-medium text-[var(--foreground)] opacity-80 mb-2">
                        Community Focus
                    </label>
                    <select
                        id="filter-community"
                        value={selectedCommunity}
                        onChange={(e) => handleCommunityChange(e.target.value)}
                        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                    >
                        <option value="">All Communities</option>
                        {communityCategories.map(cat => (
                            <option key={cat.name} value={cat.name}>{cat.name}</option>
                        ))}
                    </select>
                </div>

                {/* Borough Filter */}
                <div className="mb-6">
                    <label htmlFor="filter-borough" className="block text-sm font-medium text-[var(--foreground)] opacity-80 mb-2">
                        Borough
                    </label>
                    <select
                        id="filter-borough"
                        value={selectedBorough}
                        onChange={(e) => handleBoroughChange(e.target.value)}
                        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                    >
                        <option value="">All Boroughs</option>
                        {BOROUGHS.map(b => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                </div>

                {/* Clear Filters */}
                {(searchQuery || selectedNeed || selectedCommunity || selectedBorough) && (
                    <button
                        onClick={handleClearFilters}
                        className="w-full px-4 py-2 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] hover:bg-[var(--tag-coral-bg)] rounded-lg transition-colors"
                    >
                        Clear All Filters
                    </button>
                )}

                {/* Results count */}
                <div className="mt-4 text-sm text-[var(--muted)]">
                    {filteredServices.length} resources found
                </div>
            </div>

            {/* Middle Column: Resource Cards */}
            <div className={`${viewMode === 'list' ? 'block' : 'hidden'} md:block w-full md:w-[32rem] flex-1 flex-shrink-0 border-r border-[var(--card-border)] overflow-y-auto scrollbar-thin`}>
                <div className="p-4 space-y-4">
                    {filteredServices.length === 0 ? (
                        <div className="text-center py-8 text-[var(--muted)]">
                            No resources match your filters
                        </div>
                    ) : (
                        filteredServices.map(service => (
                            <ResourceCard
                                key={service.id}
                                service={service}
                                userLocation={userLocation}
                                onViewOnMap={(id) => {
                                    setHoveredServiceId(id);
                                    setViewMode('map');
                                }}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* Right Column: Map */}
            <div className={`${viewMode === 'map' ? 'block' : 'hidden'} md:block flex-1 relative h-full min-w-0 p-2 md:p-2`}>
                <div className="w-full h-full rounded-xl overflow-hidden shadow-lg border border-[var(--card-border)]">
                    <MapViewDynamic locations={mapLocations} highlightedId={hoveredServiceId} />
                </div>
            </div>
        </div>
    );
}

/**
 * Resource card component
 */
function ResourceCard({ service, userLocation, onViewOnMap }: {
    service: Service;
    userLocation: { lat: number; lng: number } | null;
    onViewOnMap: (id: string) => void;
}) {
    const distance = (userLocation && service.latitude && service.longitude)
        ? haversineDistance(userLocation.lat, userLocation.lng, service.latitude, service.longitude)
        : null;

    return (
        <div
            className="bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] p-4"
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-[var(--foreground)] mb-2 line-clamp-2">
                    {service.name}
                </h3>
                {distance !== null && (
                    <span className="flex-shrink-0 text-xs font-medium text-[var(--secondary)] bg-[var(--tag-blue-bg)] px-2 py-0.5 rounded-full whitespace-nowrap">
                        {distance < 0.1 ? '< 0.1' : distance.toFixed(1)} mi
                    </span>
                )}
            </div>

            {service.address && (
                <div className="text-sm text-[var(--muted)] mb-2 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 mt-0.5 flex-shrink-0" role="img" aria-label="address" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="line-clamp-2">{service.address}</span>
                    </div>
                    <button
                        onClick={() => onViewOnMap(service.id)}
                        className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--card-border)] bg-[var(--section-alt)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-white transition-colors"
                    >
                        View on map
                    </button>
                </div>
            )}

            {service.phone && (
                <p className="text-sm text-[var(--muted)] mb-1 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" role="img" aria-label="phone" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <a href={`tel:${service.phone}`} className="hover:text-[var(--primary)] underline hover:no-underline">{service.phone}</a>
                </p>
            )}

            {service.url && (
                <p className="text-sm text-[var(--muted)] mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <a
                        href={service.url.startsWith('http') ? service.url : `https://${service.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline text-[var(--primary)] truncate"
                    >
                        {service.url.replace(/^https?:\/\//, '').split('/')[0]}
                    </a>
                </p>
            )}

            {service.description && (
                <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2">
                    {service.description}
                </p>
            )}

            {/* Need Category tags */}
            {service.needFocus && service.needFocus.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {service.needFocus.map((need, i) => (
                        <TagLink
                            key={`need-${i}`}
                            colorScheme="coral"
                            size="sm"
                            href={`/services?category=${encodeURIComponent(need)}`}
                        >
                            {need}
                        </TagLink>
                    ))}
                </div>
            )}

            {/* Community Focus tags */}
            {service.communityFocus && service.communityFocus.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {service.communityFocus.map((community, i) => (
                        <TagLink
                            key={`community-${i}`}
                            colorScheme="olive"
                            size="sm"
                            href={`/services?community=${encodeURIComponent(community)}`}
                        >
                            {community}
                        </TagLink>
                    ))}
                </div>
            )}

            <Link
                href={`/services/${service.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] underline hover:no-underline"
            >
                More Details
                <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </Link>
        </div>
    );
}

/**
 * Dynamic map component (lazy loaded)
 */
import dynamic from 'next/dynamic';

const MapViewDynamic = dynamic(
    () => import('@/components/map/MapView'),
    {
        ssr: false,
        loading: () => (
            <div className="w-full h-full bg-[var(--section-alt)] flex items-center justify-center">
                <div className="text-[var(--muted)]">Loading map...</div>
            </div>
        )
    }
);
