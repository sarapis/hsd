import Link from 'next/link';

interface TagLinkProps {
    href?: string;
    children: React.ReactNode;
    colorScheme?: 'coral' | 'olive';
    size?: 'sm' | 'md';
    onClick?: () => void;
    className?: string; // Additional classes
}

/**
 * Standardized pill-shaped tag link used for taxonomic categories
 * like Need Focus (coral) and Community Focus (olive).
 */
export function TagLink({ 
    href, 
    children, 
    colorScheme = 'coral',
    size = 'md',
    onClick,
    className = ''
}: TagLinkProps) {
    const sizeClasses = size === 'sm' 
        ? "px-2 py-0.5 text-xs" 
        : "px-3 py-1 text-sm";
    
    const baseClasses = `inline-flex items-center rounded-full font-medium transition-opacity hover:opacity-80 ${sizeClasses}`;
    
    const colorClasses = colorScheme === 'coral'
        ? "bg-[var(--tag-coral-bg)] text-[var(--tag-coral-text)]"
        : "bg-[var(--tag-olive-bg)] text-[var(--tag-olive-text)]";
        
    const combinedClasses = `${baseClasses} ${colorClasses} ${className}`.trim();

    if (onClick && !href) {
        return (
            <button type="button" onClick={onClick} className={combinedClasses}>
                {children}
            </button>
        );
    }
    
    if (href) {
        return (
            <Link href={href} onClick={onClick} className={combinedClasses}>
                {children}
            </Link>
        );
    }

    return (
        <span className={combinedClasses}>
            {children}
        </span>
    );
}
