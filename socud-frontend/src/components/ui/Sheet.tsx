"use client";

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A sheet: a modal for one short, focused task (create a space, manage access, insert a formula).
 * Built on the native <dialog> element, so focus is trapped, the page behind is inert, Esc cancels
 * and focus returns to the trigger, all by the browser. Content mounts only while open, so each
 * opening starts fresh.
 *
 * Sheets have no close "x": the footer carries Cancel and the action, as on macOS.
 */
interface SheetProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    /** Keep the sheet open on a backdrop click (forms with unsaved input). */
    modalOnly?: boolean;
    className?: string;
}

const widths = { sm: 'w-[400px]', md: 'w-[520px]', lg: 'w-[720px]' };

export function Sheet({ open, onClose, title, description, children, footer, size = 'md', modalOnly, className }: SheetProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
            onMouseDown={(e) => {
                if (!modalOnly && e.target === e.currentTarget) onClose();
            }}
            className={cn(
                'sheet m-auto max-h-[min(88vh,820px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-sheet bg-elevated p-0 text-label shadow-sheet',
                widths[size],
                className,
            )}
        >
            {open && (
                <div className="animate-sheet flex max-h-[inherit] flex-col">
                    <header className="px-6 pt-5 pb-3">
                        <h2 id={titleId} className="text-title3 font-semibold">
                            {title}
                        </h2>
                        {description && (
                            <p id={descriptionId} className="mt-1 text-body text-label-2">
                                {description}
                            </p>
                        )}
                    </header>
                    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
                    {footer && (
                        <footer className="flex items-center justify-end gap-2 border-t border-separator px-6 py-3.5">{footer}</footer>
                    )}
                </div>
            )}
        </dialog>
    );
}
