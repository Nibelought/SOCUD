import { cn } from '@/lib/cn';

/** Indeterminate activity indicator (eight fading spokes, like the system's). */
export function Spinner({ className, label }: { className?: string; label?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={cn('animate-spin size-4 text-label-2', className)}
            role={label ? 'img' : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            {Array.from({ length: 8 }, (_, i) => (
                <line
                    key={i}
                    x1="12"
                    y1="3"
                    x2="12"
                    y2="7.5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    opacity={0.2 + (i / 8) * 0.8}
                    transform={`rotate(${i * 45} 12 12)`}
                />
            ))}
        </svg>
    );
}

/** Centered spinner for a region that is loading with nothing to show yet. */
export function LoadingRegion({ label = 'Loading' }: { label?: string }) {
    return (
        <div className="flex flex-1 items-center justify-center py-24" role="status">
            <Spinner className="size-6" label={label} />
        </div>
    );
}
