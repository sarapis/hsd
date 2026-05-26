'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapLocation {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    serviceName?: string;
    serviceId?: string;
    orgName?: string;
}

interface MapViewProps {
    locations: MapLocation[];
    /** ID of the currently highlighted service (e.g. from card hover). */
    highlightedId?: string | null;
}

/** Pin icon dimensions. */
const PIN_W = 28;
const PIN_H = 40;

/**
 * Generate an SVG pin image as a data URL for loading into the map sprite.
 * Uses a simple, clean teardrop shape with a dot highlight.
 */
function pinDataUrl(fill: string, stroke: string): string {
    const w = PIN_W;
    const h = PIN_H;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path d="M${w / 2},${h - 2}
        C${w / 2 - 2},${h * 0.6} 2,${h * 0.38} 2,${h * 0.33}
        A${w / 2 - 2},${w / 2 - 2} 0 1,1 ${w - 2},${h * 0.33}
        C${w - 2},${h * 0.38} ${w / 2 + 2},${h * 0.6} ${w / 2},${h - 2}Z"
        fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="${w / 2}" cy="${h * 0.3}" r="${w * 0.14}" fill="white" opacity="0.5"/>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Build a GeoJSON FeatureCollection from locations.
 */
function toGeoJSON(locations: MapLocation[]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: locations.map(loc => ({
            type: 'Feature' as const,
            geometry: {
                type: 'Point' as const,
                coordinates: [loc.longitude, loc.latitude],
            },
            properties: {
                id: loc.serviceId || loc.id,
                name: loc.serviceName || loc.name,
                locationName: loc.name,
                serviceId: loc.serviceId || '',
                orgName: loc.orgName || '',
            },
        })),
    };
}

/**
 * Interactive map using MapLibre GL with native symbol layers.
 *
 * Pins are rendered on the WebGL canvas (not DOM elements), so they
 * move perfectly in sync with the map during pan/zoom — no lag.
 */
export default function MapView({ locations, highlightedId }: MapViewProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const popupRef = useRef<maplibregl.Popup | null>(null);

    // Initialize map once
    useEffect(() => {
        if (!mapContainer.current || mapRef.current) return;

        const bounds = new maplibregl.LngLatBounds();
        locations.forEach(loc => bounds.extend([loc.longitude, loc.latitude]));

        const osmStyle: maplibregl.StyleSpecification = {
            version: 8,
            sources: {
                osm: {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                },
            },
            layers: [{
                id: 'osm-tiles',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19,
            }],
        };

        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: osmStyle,
            center: locations.length > 0
                ? [bounds.getCenter().lng, bounds.getCenter().lat]
                : [-74.006, 40.7128],
            zoom: 10,
        });

        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        mapRef.current = map;

        map.on('load', () => {
            // Load pin images into the map sprite
            const defaultImg = new Image();
            defaultImg.onload = () => {
                map.addImage('pin-default', defaultImg);

                const hlImg = new Image();
                hlImg.onload = () => {
                    map.addImage('pin-highlight', hlImg);
                    addLayers();
                };
                hlImg.src = pinDataUrl('#f59e0b', '#b45309');
            };
            defaultImg.src = pinDataUrl('#8F2D24', '#6b1f18');
        });

        function addLayers() {
            const geojson = toGeoJSON(locations);

            // Main pins source
            map.addSource('pins', { type: 'geojson', data: geojson });

            // Default pins layer
            map.addLayer({
                id: 'pins-layer',
                type: 'symbol',
                source: 'pins',
                layout: {
                    'icon-image': 'pin-default',
                    'icon-size': 1,
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
            });

            // Highlighted pin source (single feature, updated on highlight change)
            map.addSource('pin-highlight', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });

            map.addLayer({
                id: 'pin-highlight-layer',
                type: 'symbol',
                source: 'pin-highlight',
                layout: {
                    'icon-image': 'pin-highlight',
                    'icon-size': 1.25,
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
            });

            // Click handler — show popup
            map.on('click', 'pins-layer', (e) => {
                if (!e.features || e.features.length === 0) return;
                const feature = e.features[0];
                const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
                const props = feature.properties;

                // Remove existing popup
                popupRef.current?.remove();

                const linkHref = props.serviceId
                    ? `/services/${props.serviceId}`
                    : '/services';
                const linkText = props.serviceId ? 'View resource details →' : 'Browse resources →';

                const popup = new maplibregl.Popup({ offset: [0, -PIN_H] })
                    .setLngLat(coords)
                    .setHTML(`
                        <div style="padding: 8px; max-width: 220px;">
                            <h4 style="font-weight: 600; margin-bottom: 4px; color: #111; font-size: 14px;">
                                ${props.name}
                            </h4>
                            ${props.orgName 
                            ? `<p style="color: #444; font-size: 13px; font-weight: 500; margin-bottom: 2px;">${props.orgName}</p>` 
                            : ''}
                            ${props.locationName && props.locationName !== props.name
                            ? `<p style="color: #666; font-size: 12px; margin-bottom: 8px;">${props.locationName}</p>`
                            : ''}
                            <a href="${linkHref}"
                               style="color: #8F2D24; font-size: 12px; text-decoration: underline; display: inline-block; margin-top: 4px;">
                               ${linkText}
                            </a>
                        </div>
                    `)
                    .addTo(map);

                popupRef.current = popup;
            });

            // Cursor pointer on hover
            map.on('mouseenter', 'pins-layer', () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'pins-layer', () => {
                map.getCanvas().style.cursor = '';
            });

            // Fit bounds after layers are added
            if (locations.length > 0) {
                map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
            }
        }

        return () => {
            popupRef.current?.remove();
            map.remove();
            mapRef.current = null;
        };
    }, [locations]);

    // React to highlight changes
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        // Check that sources exist (layers loaded)
        if (!map.getSource('pin-highlight')) return;

        if (!highlightedId) {
            // Clear highlight
            (map.getSource('pin-highlight') as maplibregl.GeoJSONSource)
                .setData({ type: 'FeatureCollection', features: [] });
            return;
        }

        // Find the highlighted location
        const loc = locations.find(l => (l.serviceId || l.id) === highlightedId);
        if (!loc) {
            // No matching pin — reset view
            const bounds = new maplibregl.LngLatBounds();
            locations.forEach(l => bounds.extend([l.longitude, l.latitude]));
            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 800 });
            }
            return;
        }

        // Set highlight pin
        (map.getSource('pin-highlight') as maplibregl.GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
                properties: { id: loc.serviceId || loc.id, name: loc.serviceName || loc.name },
            }],
        });

        // Fly to highlighted pin
        map.flyTo({
            center: [loc.longitude, loc.latitude],
            zoom: Math.max(map.getZoom(), 14),
            duration: 800,
        });
    }, [highlightedId, locations]);

    return (
        <div
            ref={mapContainer}
            className="w-full h-full"
            style={{ minHeight: '400px' }}
        />
    );
}
