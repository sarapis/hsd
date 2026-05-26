import { Suspense } from "react";
import { Metadata } from "next";
import { getMapServices } from "@/lib/api";
import MapPageClient from "./MapPageClient";

export const metadata: Metadata = {
    title: "Services",
    description: "Find community services and resources on an interactive map.",
};

/**
 * Services page — interactive map with filters, search, and proximity sorting.
 * Suspense boundary required because MapPageClient uses useSearchParams().
 */
export default async function ServicesPage() {
    let services: any[] = [];
    let needCategories: any[] = [];
    let communityCategories: any[] = [];
    let error = null;

    try {
        const data = await getMapServices();
        services = data.services;
        needCategories = data.needCategories;
        communityCategories = data.communityCategories;
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to load services";
        console.error("Failed to fetch services:", e);
    }

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8">
                <div className="rounded-xl bg-[#fce8e5] border border-[var(--accent-border)] p-4">
                    <p className="text-[var(--primary)]">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <Suspense fallback={
            <div className="container mx-auto px-4 py-8 text-center text-[var(--muted)]">
                Loading resources…
            </div>
        }>
            <MapPageClient
                services={services}
                needCategories={needCategories}
                communityCategories={communityCategories}
            />
        </Suspense>
    );
}
