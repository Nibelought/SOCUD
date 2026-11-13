"use client";

import { useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { initials, personColor } from '@/lib/currentUser';
import { spaceInitial, spaceTint } from '@/lib/spaceColor';

/* Segmented control: switches between views of the same content (radio semantics, arrow keys). */
export function SegmentedControl<T extends string>({
    value,
    onChange,
    options,
    label,
    className,
}: {
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: string; icon?: LucideIcon }[];
    label: string;
    className?: string;
}) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const move = (from: number, delta: number) => {
        const next = (from + delta + options.length) % options.length;
        onChange(options[next].value);
        refs.current[next]?.focus();
    };
    return (
        <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-[8px] bg-fill p-0.5', className)}>
            {options.map((option, i) => {
                const selected = option.value === value;
                const Icon = option.icon;
                return (
                    <button
                        key={option.value}
                        ref={(el) => {
                            refs.current[i] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                                e.preventDefault();
                                move(i, 1);
                            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                move(i, -1);
                            }
                        }}
                        className={cn(
                            'inline-flex h-6 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-footnote font-medium transition-colors',
                            selected ? 'bg-elevated text-label shadow-tile' : 'text-label-2 hover:text-label',
                        )}
                    >
                        {Icon && <Icon className="size-3.5" strokeWidth={1.9} aria-hidden />}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/* Person avatar: initials on a stable color. Decorative unless `label` is given. */
export function Avatar({ name, colorKey, size = 28, label, ring }: { name: string; colorKey?: string; size?: number; label?: string; ring?: boolean }) {
    return (
        <span
            role={label ? 'img' : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
            title={label}
            className={cn(
                'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
                ring && 'ring-2 ring-window',
            )}
            style={{ width: size, height: size, fontSize: Math.round(size * 0.4), backgroundColor: personColor(colorKey ?? name) }}
        >
            {initials(name)}
        </span>
    );
}

/* A space's icon: its initial on its color, a rounded square (like Reminders' lists). */
export function SpaceIcon({ id, name, size = 'md' }: { id: string; name: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
    const dims = {
        xs: 'size-4 rounded-[4px] text-[10px]',
        sm: 'size-5 rounded-[5px] text-[11px]',
        md: 'size-9 rounded-[9px] text-headline',
        lg: 'size-14 rounded-[14px] text-title2',
    }[size];
    return (
        <span
            aria-hidden
            style={spaceTint(id)}
            className={cn('inline-flex shrink-0 select-none items-center justify-center bg-tint font-semibold leading-none text-white', dims)}
        >
            {spaceInitial(name)}
        </span>
    );
}

/* Empty and error states: say what is here (or what went wrong) and invite the next action. */
export function EmptyState({
    icon: Icon,
    title,
    children,
    action,
    className,
}: {
    icon?: LucideIcon;
    title: string;
    children?: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex flex-col items-center px-6 py-16 text-center', className)}>
            {Icon && <Icon className="mb-3 size-10 text-label-3" strokeWidth={1.4} aria-hidden />}
            <h2 className="text-title3 font-semibold text-label">{title}</h2>
            {children && <div className="mt-1.5 max-w-sm text-body text-label-2">{children}</div>}
            {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
        </div>
    );
}

export function Kbd({ children }: { children: ReactNode }) {
    return (
        <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-fill px-1 font-sans text-caption font-medium text-label-2">
            {children}
        </kbd>
    );
}

/* Placeholder rows while a list loads: the layout appears at once, without a spinner. */
export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
    return (
        <div className={cn('flex flex-col', className)} aria-hidden>
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="flex h-11 items-center gap-3 px-3">
                    <div className="animate-shimmer size-5 rounded-[5px] bg-fill" />
                    <div className="animate-shimmer h-3 rounded bg-fill" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
                </div>
            ))}
        </div>
    );
}

/* Section heading inside a page: plain, sentence case, with an optional trailing action. */
export function SectionHeader({ title, action, id }: { title: string; action?: ReactNode; id?: string }) {
    return (
        <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
            <h2 id={id} className="text-title3 font-semibold text-label">
                {title}
            </h2>
            {action}
        </div>
    );
}
