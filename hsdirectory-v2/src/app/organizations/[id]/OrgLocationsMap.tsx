'use client';

import dynamic from 'next/dynamic';

/**
 * Dynamically import MapView to avoid SSR issues with maplibre-gl.
 */
const MapViewDynamic = dynamic(
    () => import('@/components/map/MapView'),
    {
        ssr: false,
        loading: () => (
            <div className="w-full h-[300px] bg-[var(--section-alt)] flex items-center justify-center">
                <p className="text-[var(--muted)] text-sm">Loading map…</p>
            </div>
        ),
    }
);

interface MapPin {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    serviceName: string;
    serviceId: string;
}

interface OrgLocationsMapProps {
    locations: MapPin[];
}

/**
 * Multi-pin map for organization profile pages.
 * Wraps MapView with a fixed height to fit in the sidebar.
 */
export default function OrgLocationsMap({ locations }: OrgLocationsMapProps) {
    return (
        <div style={{ height: '300px' }}>
            <MapViewDynamic locations={locations} />
        </div>
    );
}
