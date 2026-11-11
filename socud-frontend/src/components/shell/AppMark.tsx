import { cn } from '@/lib/cn';

/**
 * SOCUD's mark: three documents joined by links, the knowledge graph in miniature. Drawn on the
 * accent color as a rounded square, like an app icon.
 */
export function AppMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--c-accent)" />
            <g stroke="var(--c-on-accent)" strokeWidth="2" strokeLinecap="round" opacity="0.75">
                <line x1="10" y1="21" x2="16" y2="10" />
                <line x1="16" y1="10" x2="22.5" y2="20" />
                <line x1="10" y1="21" x2="22.5" y2="20" />
            </g>
            <circle cx="16" cy="10" r="3.6" fill="var(--c-on-accent)" />
            <circle cx="10" cy="21" r="3" fill="var(--c-on-accent)" />
            <circle cx="22.5" cy="20" r="2.4" fill="var(--c-on-accent)" />
        </svg>
    );
}
