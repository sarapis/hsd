'use client';

import dynamic from 'next/dynamic';

interface ServiceLocationMapProps {
    latitude: number;
    longitude: number;
    name: string;
}

const MapViewDynamic = dynamic(
    () => import('@/components/map/MapView'),
    {
        ssr: false,
        loading: () => (
            <div className="w-full h-64 bg-[var(--section-alt)] rounded-xl flex items-center justify-center">
                <div className="text-[var(--muted)]">Loading map...</div>
            </div>
        )
    }
);

/**
 * Small map showing a single service location.
 */
export default function ServiceLocationMap({ latitude, longitude, name }: ServiceLocationMapProps) {
    const locations = [{
        id: 'service-location',
        name,
        latitude,
        longitude,
        serviceName: name,
    }];

    return (
        <div className="rounded-xl overflow-hidden border border-[var(--card-border)] h-64">
            <MapViewDynamic locations={locations} />
        </div>
    );
}
