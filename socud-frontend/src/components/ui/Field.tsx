"use client";

import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Form fields with a visible label, an optional hint and an inline error (announced to screen
 * readers through aria-describedby). Errors say what is wrong and how to fix it.
 */
const control =
    'w-full rounded-field bg-window text-label text-body px-3 shadow-[inset_0_0_0_1px_var(--c-separator-strong)] ' +
    'transition-shadow duration-100 outline-none focus:shadow-[inset_0_0_0_1px_var(--c-accent),0_0_0_3px_color-mix(in_srgb,var(--c-accent)_25%,transparent)] ' +
    'disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--c-danger)]';

interface FieldShellProps {
    label: string;
    hint?: ReactNode;
    error?: string | null;
    hideLabel?: boolean;
    className?: string;
    children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

function FieldShell({ label, hint, error, hideLabel, className, children }: FieldShellProps) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <label htmlFor={id} className={cn('text-footnote font-medium text-label', hideLabel && 'sr-only')}>
                {label}
            </label>
            {children({ id, describedBy })}
            {error ? (
                <p id={errorId} className="text-footnote text-danger">
                    {error}
                </p>
            ) : hint ? (
                <p id={hintId} className="text-footnote text-label-2">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}

type InputProps = Omit<ComponentProps<'input'>, 'id'> & {
    label: string;
    hint?: ReactNode;
    error?: string | null;
    hideLabel?: boolean;
    containerClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField(
    { label, hint, error, hideLabel, containerClassName, className, ...rest },
    ref,
) {
    return (
        <FieldShell label={label} hint={hint} error={error} hideLabel={hideLabel} className={containerClassName}>
            {({ id, describedBy }) => (
                <input
                    ref={ref}
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={error ? true : undefined}
                    className={cn(control, 'h-9', className)}
                    {...rest}
                />
            )}
        </FieldShell>
    );
});

type TextAreaProps = Omit<ComponentProps<'textarea'>, 'id'> & {
    label: string;
    hint?: ReactNode;
    error?: string | null;
    containerClassName?: string;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
    { label, hint, error, containerClassName, className, ...rest },
    ref,
) {
    return (
        <FieldShell label={label} hint={hint} error={error} className={containerClassName}>
            {({ id, describedBy }) => (
                <textarea
                    ref={ref}
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={error ? true : undefined}
                    className={cn(control, 'py-2 resize-none leading-5', className)}
                    {...rest}
                />
            )}
        </FieldShell>
    );
});

type SelectProps = Omit<ComponentProps<'select'>, 'id'> & {
    label: string;
    hint?: ReactNode;
    error?: string | null;
    hideLabel?: boolean;
    containerClassName?: string;
};

/** Native select (pop-up button): the platform's own menu, keyboard and screen-reader behavior. */
export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(function SelectField(
    { label, hint, error, hideLabel, containerClassName, className, children, ...rest },
    ref,
) {
    return (
        <FieldShell label={label} hint={hint} error={error} hideLabel={hideLabel} className={containerClassName}>
            {({ id, describedBy }) => <Select ref={ref} id={id} aria-describedby={describedBy} className={className} {...rest}>{children}</Select>}
        </FieldShell>
    );
});

/** Bare pop-up button without a label row, for tables ("Viewer ▾"). Give it an aria-label. */
export const Select = forwardRef<HTMLSelectElement, ComponentProps<'select'> & { compact?: boolean }>(function Select(
    { className, children, compact, ...rest },
    ref,
) {
    return (
        <div className={cn('relative', compact ? 'inline-flex' : 'flex')}>
            <select
                ref={ref}
                className={cn(
                    control,
                    'appearance-none pr-8',
                    compact ? 'h-7 text-footnote pl-2.5 bg-transparent shadow-none hover:bg-hover focus:bg-window' : 'h-9',
                    className,
                )}
                {...rest}
            >
                {children}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-label-2" aria-hidden />
        </div>
    );
});
