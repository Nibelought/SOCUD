"use client";

import Link from 'next/link';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

/**
 * Buttons follow macOS: one `primary` (filled accent) action per view at most two, `secondary` for
 * the rest, `plain` for inline and toolbar text actions, `destructive` for irreversible ones (used in
 * alerts). Labels use title-style capitalization ("New Document").
 *
 * Sizes: sm 28 px (toolbars, rows), md 32 px (default), lg 40 px (sign-in, sheet footers on touch).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive' | 'destructive-plain';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium select-none ' +
    'transition-[background-color,color,opacity] duration-100 disabled:opacity-40 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover active:opacity-90',
    secondary: 'bg-fill text-label hover:bg-fill-strong active:bg-fill-strong',
    plain: 'text-accent hover:bg-hover active:bg-fill',
    destructive: 'bg-danger text-white hover:opacity-90 active:opacity-80',
    'destructive-plain': 'text-danger hover:bg-hover active:bg-fill',
};

const sizes: Record<ButtonSize, string> = {
    sm: 'h-7 px-2.5 text-body rounded-control',
    md: 'h-8 px-3 text-body rounded-control',
    lg: 'h-10 px-4 text-headline rounded-field',
};

const iconSizes: Record<ButtonSize, string> = { sm: 'size-4', md: 'size-4', lg: 'size-[18px]' };

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
    return cn(base, variants[variant], sizes[size], className);
}

interface CommonProps {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: LucideIcon;
    loading?: boolean;
    children?: ReactNode;
}

type ButtonProps = CommonProps & Omit<ComponentProps<'button'>, 'children'>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'secondary', size = 'md', icon: Icon, loading, children, className, disabled, type = 'button', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={buttonClasses(variant, size, className)}
            {...rest}
        >
            {loading ? <Spinner className={iconSizes[size]} /> : Icon ? <Icon className={iconSizes[size]} strokeWidth={1.9} aria-hidden /> : null}
            {children}
        </button>
    );
});

type ButtonLinkProps = CommonProps & Omit<ComponentProps<typeof Link>, 'children'>;

/** A link styled as a button, for navigation actions ("Open Editor"). */
export function ButtonLink({ variant = 'secondary', size = 'md', icon: Icon, children, className, ...rest }: ButtonLinkProps) {
    return (
        <Link className={buttonClasses(variant, size, className)} {...rest}>
            {Icon ? <Icon className={iconSizes[size]} strokeWidth={1.9} aria-hidden /> : null}
            {children}
        </Link>
    );
}

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
    icon: LucideIcon;
    /** Accessible name; also shown as the tooltip. */
    label: string;
    size?: 'sm' | 'md';
    active?: boolean;
    /** Keyboard shortcut shown in the tooltip, e.g. "⌘B". */
    shortcut?: string;
}

/** Toolbar-style icon button. Always has a label for screen readers and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { icon: Icon, label, size = 'md', active, shortcut, className, type = 'button', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            aria-label={label}
            title={shortcut ? `${label} (${shortcut})` : label}
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-control text-label-2 transition-colors duration-100',
                'hover:bg-hover hover:text-label active:bg-fill disabled:opacity-40 disabled:pointer-events-none',
                size === 'sm' ? 'size-7' : 'size-8',
                active && 'bg-fill-strong text-label',
                className,
            )}
            {...rest}
        >
            <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} strokeWidth={1.8} aria-hidden />
        </button>
    );
});
