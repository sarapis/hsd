'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { SearchBar } from './SearchBar';

interface HeaderProps {
    showSearch?: boolean;
}

/**
 * Site header with navigation and optional search bar.
 * Dark teal background matching mutualaid.nyc (#204045).
 * Search bar auto-hides on homepage where a hero search already exists.
 */
export function Header({ showSearch }: HeaderProps) {
    const pathname = usePathname();
    const isHome = pathname === '/';
    const shouldShowSearch = showSearch ?? !isHome;
    return (
        <header className="sticky top-0 z-50 w-full bg-[var(--nav-bg)]">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-3">
                    <Image
                        src="/logo.png"
                        alt="Mutual Aid NYC logo"
                        width={60}
                        height={60}
                        className="rounded-full"
                    />
                    <span className="hidden md:inline font-display text-xl text-[var(--nav-text)] tracking-tight">
                        Community Resources Library
                    </span>
                </Link>

                {/* Search Bar (compact) */}
                {shouldShowSearch && (
                    <div className="hidden md:block flex-1 max-w-md mx-8">
                        <SearchBar size="sm" placeholder="Search resources..." />
                    </div>
                )}

                {/* Navigation */}
                <nav className="flex items-center gap-4 md:gap-6">
                    <Link
                        href="/services"
                        className="text-sm font-semibold hover:text-[var(--highlight)] transition-colors tracking-tight"
                        style={{ color: '#FFFFFF' }}
                    >
                        Resources
                    </Link>
                    <Link
                        href="/organizations"
                        className="text-sm font-semibold hover:text-[var(--highlight)] transition-colors tracking-tight"
                        style={{ color: '#FFFFFF' }}
                    >
                        Groups
                    </Link>
                </nav>
            </div >
        </header >
    );
}
