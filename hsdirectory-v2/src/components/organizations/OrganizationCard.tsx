import Link from 'next/link';
import { Organization } from '@/lib/api';

interface OrganizationCardProps {
    organization: Organization;
}

/**
 * Card component for displaying group summary in lists.
 */
export function OrganizationCard({ organization }: OrganizationCardProps) {
    return (
        <Link
            href={`/organizations/${organization.id}`}
            className="group flex flex-col justify-between h-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-sm 
            transition-all hover:border-[var(--primary)]/40 hover:shadow-md"
        >
            <div className="min-w-0">
                {/* Group Name */}
                <h3 className="font-semibold text-lg text-[var(--foreground)] group-hover:text-[var(--primary)]">
                    {organization.name}
                </h3>
                {/* Description */}
                {organization.description && (
                    <p className="mt-2 text-[var(--muted)] line-clamp-3">
                        {organization.description}
                    </p>
                )}
            </div>

            {/* Resource Count */}
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {organization.service_count !== undefined && organization.service_count > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--tag-olive-bg)] text-[var(--tag-olive-text)]">
                        <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {organization.service_count} {organization.service_count === 1 ? 'Resource' : 'Resources'}
                    </span>
                )}
                {organization.url && (
                    <span className="text-[var(--secondary)] flex items-center gap-1">
                        <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Website
                    </span>
                )}
            </div>
        </Link>
    );
}
