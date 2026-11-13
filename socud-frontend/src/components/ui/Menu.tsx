"use client";

import Link from 'next/link';
import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    type Ref,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ---------------------------------------------------------------------------------------------
 * Popover: a panel anchored to its trigger. Closes on Esc, on an outside click and when focus
 * leaves it; focus returns to the trigger.
 * ------------------------------------------------------------------------------------------- */
export interface TriggerProps {
    ref: Ref<HTMLButtonElement>;
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup'?: 'menu' | 'dialog';
}

interface PopoverProps {
    trigger: (props: TriggerProps) => ReactNode;
    children: (close: () => void) => ReactNode;
    align?: 'start' | 'end';
    side?: 'bottom' | 'top';
    className?: string;
    role?: 'dialog' | 'menu';
    label?: string;
    /** Called when the popover opens (e.g. to focus a field). */
    onOpen?: () => void;
}

function usePopoverState() {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const close = useCallback((refocus = true) => {
        setOpen(false);
        if (refocus) triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (!wrapperRef.current?.contains(e.target as Node)) close(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open, close]);

    return { open, setOpen, wrapperRef, triggerRef, close };
}

const panelBase =
    'animate-pop absolute z-50 min-w-[200px] rounded-tile bg-elevated p-1 text-label shadow-popover';

export function Popover({ trigger, children, align = 'start', side = 'bottom', className, role = 'dialog', label, onOpen }: PopoverProps) {
    const { open, setOpen, wrapperRef, triggerRef, close } = usePopoverState();
    const panelId = useId();

    useEffect(() => {
        if (open) onOpen?.();
    }, [open, onOpen]);

    return (
        <div ref={wrapperRef} className="relative inline-flex">
            {trigger({
                ref: triggerRef,
                onClick: () => setOpen((o) => !o),
                'aria-expanded': open,
                'aria-controls': panelId,
                'aria-haspopup': 'dialog',
            })}
            {open && (
                <div
                    id={panelId}
                    role={role}
                    aria-label={label}
                    onBlur={(e) => {
                        if (!wrapperRef.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) close(false);
                    }}
                    style={{ ['--origin' as string]: `${side === 'bottom' ? 'top' : 'bottom'} ${align === 'end' ? 'right' : 'left'}` }}
                    className={cn(
                        panelBase,
                        side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
                        align === 'end' ? 'right-0' : 'left-0',
                        className,
                    )}
                >
                    {children(() => close())}
                </div>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------------------------------
 * Menu: a pull-down menu of commands. Arrow keys move, Home/End jump, typing a letter jumps to the
 * next item starting with it, Enter/Space choose, Esc closes.
 * ------------------------------------------------------------------------------------------- */
export type MenuItem =
    | {
          label: string;
          icon?: LucideIcon;
          onSelect?: () => void;
          href?: string;
          destructive?: boolean;
          disabled?: boolean;
          shortcut?: string;
          checked?: boolean;
      }
    | { separator: true }
    | { heading: string };

interface MenuProps {
    trigger: (props: TriggerProps) => ReactNode;
    items: MenuItem[];
    align?: 'start' | 'end';
    label: string;
    className?: string;
}

export function Menu({ trigger, items, align = 'start', label, className }: MenuProps) {
    const { open, setOpen, wrapperRef, triggerRef, close } = usePopoverState();
    const menuId = useId();
    const menuRef = useRef<HTMLDivElement>(null);

    const enabledItems = () =>
        Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

    useEffect(() => {
        if (open) enabledItems()[0]?.focus();
    }, [open]);

    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        const list = enabledItems();
        const index = list.indexOf(document.activeElement as HTMLElement);
        const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                focus(index + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                focus(index - 1);
                break;
            case 'Home':
                e.preventDefault();
                focus(0);
                break;
            case 'End':
                e.preventDefault();
                focus(list.length - 1);
                break;
            case 'Tab':
                close(false);
                break;
            default:
                if (e.key.length === 1 && /\S/.test(e.key)) {
                    const start = index + 1;
                    const ordered = [...list.slice(start), ...list.slice(0, start)];
                    ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()))?.focus();
                }
        }
    };

    return (
        <div ref={wrapperRef} className="relative inline-flex">
            {trigger({
                ref: triggerRef,
                onClick: () => setOpen((o) => !o),
                'aria-expanded': open,
                'aria-controls': menuId,
                'aria-haspopup': 'menu',
            })}
            {open && (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                    style={{ ['--origin' as string]: `top ${align === 'end' ? 'right' : 'left'}` }}
                    className={cn(panelBase, 'top-full mt-1.5', align === 'end' ? 'right-0' : 'left-0', className)}
                >
                    {items.map((item, i) => {
                        if ('separator' in item) return <div key={i} role="separator" className="mx-2 my-1 h-px bg-separator" />;
                        if ('heading' in item)
                            return (
                                <div key={i} role="presentation" className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-label-2">
                                    {item.heading}
                                </div>
                            );
                        const Icon = item.icon;
                        const content = (
                            <>
                                {Icon ? <Icon className="size-4 shrink-0" strokeWidth={1.8} aria-hidden /> : item.checked !== undefined ? <span className="size-4" /> : null}
                                <span className="flex-1 text-left">{item.label}</span>
                                {item.checked && <span aria-hidden>✓</span>}
                                {item.shortcut && <span className="text-footnote text-label-2 group-focus:text-current">{item.shortcut}</span>}
                            </>
                        );
                        const classes = cn(
                            'group flex h-7 w-full items-center gap-2 rounded-[6px] px-2.5 text-body outline-none',
                            'focus:bg-accent focus:text-on-accent hover:bg-accent hover:text-on-accent',
                            item.destructive && 'text-danger',
                            item.disabled && 'opacity-40 pointer-events-none',
                        );
                        const select = () => {
                            close();
                            item.onSelect?.();
                        };
                        return item.href ? (
                            <Link key={i} href={item.href} role="menuitem" tabIndex={-1} className={classes} onClick={() => close(false)}>
                                {content}
                            </Link>
                        ) : (
                            <button
                                key={i}
                                type="button"
                                role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                                aria-checked={item.checked}
                                aria-disabled={item.disabled || undefined}
                                tabIndex={-1}
                                className={classes}
                                onClick={select}
                            >
                                {content}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
