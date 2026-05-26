import Link from "next/link";
import { SearchBar } from "@/components/ui/SearchBar";
import { getServices, getOrganizations, getMapServices } from "@/lib/api";

/**
 * Map taxonomy term names to display icons.
 */
const CATEGORY_ICONS: Record<string, string> = {
  "Food": "🍎",
  "Housing": "🏠",
  "Legal": "⚖️",
  "Medical": "🏥",
  "Education": "📚",
  "Jobs": "💼",
  "Money": "💰",
  "Mental & Behavioral Health": "🧠",
  "Safety from Violence": "🛡️",
  "Clothing": "👕",
  "Social Service Guidance": "🤝",
  "Childcare and Pregnancy": "👶",
  "Eldercare": "👵",
  "Exercise and Wellness": "🏃",
  "Fun and Leisure": "🎭",
  "Internet and Technology": "💻",
  "Petcare": "🐾",
  "Delivery/Transport": "🚗",
  "Disaster Response": "🚨",
  "Mutual Aid Organizing": "✊",
  "Personal Protective Equipment": "😷",
  "Socializing": "💬",
  "Additional Resource Libraries": "📖",
};

/**
 * Warm earthy color palette for category cards (mutualaid.nyc style).
 */
const CARD_COLORS = [
  { bg: "bg-[#fce8e5]", text: "text-[#8F2D24]" },
  { bg: "bg-[#ebf3f3]", text: "text-[#204045]" },
  { bg: "bg-[#fdf7e6]", text: "text-[#6b5a1e]" },
  { bg: "bg-[#f3ebf1]", text: "text-[#47133d]" },
  { bg: "bg-[#e6f0e8]", text: "text-[#204045]" },
  { bg: "bg-[#fce8e5]", text: "text-[#8F2D24]" },
  { bg: "bg-[#ebf3f3]", text: "text-[#204045]" },
  { bg: "bg-[#fdf7e6]", text: "text-[#6b5a1e]" },
];

/** Terms to exclude from the homepage grid. */
const EXCLUDED_TERMS = new Set(["-Not Listed", "Not Listed"]);

/**
 * Homepage with warm community-oriented design inspired by mutualaid.nyc.
 */
export default async function Home() {
  let stats = { resources: 0, groups: 0 };
  let categories: { name: string; icon?: string | null }[] = [];

  try {
    const [servicesRes, orgsRes, mapData] = await Promise.all([
      getServices(1, 1),
      getOrganizations(1, 1),
      getMapServices(),
    ]);
    stats = {
      resources: servicesRes.total_items || 0,
      groups: orgsRes.total_items || 0,
    };
    categories = (mapData.needCategories || [])
    .filter((c: any) => !EXCLUDED_TERMS.has(c.name));
  } catch (error) {
    console.error("Failed to fetch homepage data:", error);
  }

  return (
    <div className="flex flex-col">
      {/* Hero Section — warm cream with serif heading */}
      <section className="py-24 px-4 bg-[var(--background)]">
        <div className="container mx-auto">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="font-display text-5xl md:text-6xl font-bold text-[var(--secondary)] mb-6">
              Mutual Aid <span className="bg-[var(--highlight)] text-[var(--tertiary)] px-2">NYC</span>
            </h1>
            <p className="text-xl text-[var(--muted)] mb-4">
              We help build and strengthen local mutual aid networks.
            </p>
            <p className="text-lg text-[var(--muted)] mb-10">
              Search our directory of {stats.resources.toLocaleString()} resources
              from {stats.groups.toLocaleString()} groups
            </p>
            <SearchBar placeholder="What resource are you looking for?" />
          </div>
        </div>
      </section>

      {/* I am... CTA Section */}
      <section className="py-12 px-4 bg-[var(--section-alt)]">
        <div className="container mx-auto">
          <h2 className="font-display text-2xl font-bold text-center text-[var(--foreground)] mb-8">
            I am…
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <Link
              href="/services"
              className="group flex flex-col items-center gap-3 p-8 rounded-2xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] shadow-md hover:shadow-lg transition-all"
              style={{ color: "#FFFFFF" }}
            >
              <svg className="w-8 h-8" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-lg font-semibold">looking for HELP</span>
            </Link>

            <Link
              href="https://mutualaid.nyc/get-involved/"
              className="group flex flex-col items-center gap-3 p-8 rounded-2xl bg-[var(--secondary)] hover:bg-[var(--secondary-hover)] shadow-md hover:shadow-lg transition-all"
              style={{ color: "#FFFFFF" }}
            >
              <svg className="w-8 h-8" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              <span className="text-lg font-semibold">looking to VOLUNTEER</span>
            </Link>

            <Link
              href="https://mutualaid.nyc/for-groups-organizers/"
              className="group flex flex-col items-center gap-3 p-8 rounded-2xl bg-[var(--tertiary)] hover:opacity-80 shadow-md hover:shadow-lg transition-all"
              style={{ color: "#FFFFFF" }}
            >
              <svg className="w-8 h-8" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-lg font-semibold">a GROUP/ORGANIZER</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Resource Categories — warm earthy colored cards */}
      {categories.length > 0 && (
        <section className="py-16 px-4">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-display text-2xl font-bold text-[var(--foreground)]">
                Browse By Category
              </h2>
              <Link
                href="/services"
                className="text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium transition-colors underline hover:no-underline"
              >
                View all resources →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {categories.map((category, index) => {
                const color = CARD_COLORS[index % CARD_COLORS.length];
                return (
                  <Link
                    key={category.name}
                    href={`/services?category=${encodeURIComponent(category.name)}`}
                    className={`group flex items-center gap-3 p-5 rounded-2xl ${color.bg} border border-[var(--card-border)] hover:shadow-md transition-all`}
                  >
                    <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                      {category.icon ? (
                        <img
                          src={category.icon}
                          alt=""
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        CATEGORY_ICONS[category.name] || "📋"
                      )}
                    </span>
                    <span className={`text-sm font-semibold ${color.text}`}>
                      {category.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
