import Link from 'next/link';
import { Service } from '@/lib/api';

interface ServiceCardProps {
    service: Service;
}

/**
 * Card component for displaying service summary in lists.
 * Shows name, description, and group.
 */
export function ServiceCard({ service }: ServiceCardProps) {
    return (
        <Link
            href={`/services/${service.id}`}
            className="group block rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-sm 
        transition-all hover:border-[var(--primary)]/40 hover:shadow-md"
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    {/* Service Name */}
                    <h3 className="font-semibold text-lg text-[var(--foreground)] group-hover:text-[var(--primary)] truncate">
                        {service.name}
                    </h3>

                    {/* Group (Organization) */}
                    {service.organization && (
                        <p className="mt-1 text-sm text-[var(--muted)] flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 shrink-0" aria-label="group" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {service.organization.name}
                        </p>
                    )}

                    {/* Description */}
                    {service.description && (
                        <p className="mt-3 text-[var(--muted)] line-clamp-2">
                            {service.description}
                        </p>
                    )}
            </div>
            </div>

            {/* Footer with address */}
            {(() => {
                const loc = service.service_at_locations?.find(s => s.location?.addresses?.length);
                const addr = loc?.location?.addresses?.[0];
                if (!addr) return null;
                const parts = [addr.address_1, addr.city, addr.state_province].filter(Boolean);
                if (parts.length === 0) return null;
                return (
                    <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
                        <p className="text-sm text-[var(--muted)] flex items-center gap-1">
                            <svg className="w-4 h-4 shrink-0" aria-label="address" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="truncate">{parts.join(', ')}</span>
                        </p>
                    </div>
                );
            })()}
        </Link>
    );
}
