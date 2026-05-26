import { Metadata } from "next";
import { getOrganizations, Organization } from "@/lib/api";
import { OrganizationCard } from "@/components/organizations/OrganizationCard";
import { Pagination } from "@/components/ui/Pagination";
import { OrgSearch } from "./OrgSearch";

export const metadata: Metadata = {
    title: "Groups",
    description: "Browse groups providing community resources.",
};

interface OrganizationsPageProps {
    searchParams: Promise<{ page?: string; q?: string }>;
}

/**
 * Groups listing page with search and pagination.
 * The `q` param drives server-side text search against the API.
 */
export default async function OrganizationsPage({ searchParams }: OrganizationsPageProps) {
    const params = await searchParams;
    const page = parseInt(params.page || "1");
    const query = params.q || "";

    let organizations: Organization[] = [];
    let totalPages = 1;
    let totalItems = 0;
    let error = null;

    try {
        const response = await getOrganizations(page, 12, query || undefined);
        organizations = response.contents || [];
        totalPages = response.total_pages || 1;
        totalItems = response.total_items || 0;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to load organizations";
        console.error("Failed to fetch organizations:", e);
    }

    // Build pagination URL preserving search query
    const paginationBase = query ? `/organizations?q=${encodeURIComponent(query)}` : "/organizations";

    return (
        <div className="container mx-auto px-4 py-8">
            {/* Page Header */}
            <div className="mb-8">
                <h1 className="font-display text-3xl font-bold text-[var(--foreground)] mb-4">
                    Groups
                </h1>
                <p className="text-[var(--muted)]">
                    {totalItems.toLocaleString()} groups providing community resources
                </p>
            </div>

            {/* Search Input */}
            <div className="mb-8">
                <OrgSearch initialQuery={query} />
            </div>

            {/* Error State */}
            {error && (
                <div className="rounded-xl bg-[var(--tag-coral-bg)] border border-[var(--primary)]/20 p-4 mb-8">
                    <p className="text-[var(--tag-coral-text)]">{error}</p>
                </div>
            )}

            {/* Groups Grid */}
            {organizations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {organizations.map((org) => (
                        <OrganizationCard key={org.id} organization={org} />
                    ))}
                </div>
            ) : !error ? (
                <div className="text-center py-16">
                    <h3 className="text-lg font-medium text-[var(--foreground)] mb-2">
                        {query ? `No results for "${query}"` : "No groups found"}
                    </h3>
                    <p className="text-[var(--muted)]">
                        {query ? "Try a different search term." : "No groups are currently available."}
                    </p>
                </div>
            ) : null}

            {/* Pagination */}
            {totalPages > 1 && (
                <Pagination currentPage={page} totalPages={totalPages} baseUrl={paginationBase} />
            )}
        </div>
    );
}
