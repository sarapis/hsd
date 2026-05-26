import Link from 'next/link';

/**
 * Site footer with warm navy background and cream text.
 */
export function Footer() {
    return (
        <footer className="border-t border-[var(--card-border)] bg-[var(--nav-bg)]">
            <div className="container mx-auto px-4 py-8">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    {/* Branding */}
                    <div className="flex items-center gap-2">
                        <span className="font-display text-lg font-bold text-[var(--nav-text)]">
                            Mutual Aid <span className="text-[var(--highlight)]">NYC</span>
                        </span>
                    </div>

                    {/* Links */}
                    <nav className="flex flex-wrap gap-6 text-sm">
                        <Link 
                            href="/services" 
                            className="!text-white hover:!text-[var(--highlight)] hover:no-underline transition-all duration-200 font-medium"
                        >
                            Resources
                        </Link>
                        <Link 
                            href="/organizations" 
                            className="!text-white hover:!text-[var(--highlight)] hover:no-underline transition-all duration-200 font-medium"
                        >
                            Groups
                        </Link>
                    </nav>

                    {/* Attribution */}
                    <p className="text-sm text-[var(--nav-text)] opacity-50">
                        Powered by{' '}
                        <a
                            href="https://openreferral.org"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:no-underline underline transition-opacity"
                            style={{ color: 'inherit' }}
                        >
                            Open Referral HSDS
                        </a>
                    </p>
                </div>
            </div>
        </footer>
    );
}
