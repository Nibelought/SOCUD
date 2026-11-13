"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/* ---------------------------------------------------------------------------------------------
 * Toasts: brief confirmation of what just happened ("Published version 4"). They appear at the top
 * trailing corner under the toolbar (clear of the writing column), on an opaque surface so text
 * never mixes with the content beneath, are announced politely to screen readers, and disappear on
 * their own. Errors stay a bit
 * longer. Never use a toast for something people must act on: use an alert or inline message.
 * ------------------------------------------------------------------------------------------- */
type Tone = 'success' | 'error' | 'info';
interface ToastAction {
    label: string;
    onClick: () => void;
}
interface Toast {
    id: number;
    title: string;
    description?: string;
    tone: Tone;
    action?: ToastAction;
}

interface ConfirmOptions {
    title: string;
    message?: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
}

interface FeedbackApi {
    /** `action` adds one button, typically Undo; such toasts stay longer. */
    toast: (toast: { title: string; description?: string; tone?: Tone; action?: ToastAction }) => void;
    /** Resolves true when the person confirms. Cancel is the default button. */
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
    const ctx = useContext(FeedbackContext);
    if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>');
    return ctx;
}

const toneIcon = { success: CheckCircle2, error: XCircle, info: Info };
const toneColor = { success: 'text-success', error: 'text-danger', info: 'text-accent' };

export function FeedbackProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
    const nextId = useRef(1);

    const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

    const toast = useCallback<FeedbackApi['toast']>(
        ({ title, description, tone = 'success', action }) => {
            const id = nextId.current++;
            setToasts((all) => [...all.slice(-2), { id, title, description, tone, action }]);
            setTimeout(() => dismiss(id), action ? 8000 : tone === 'error' ? 7000 : 4000);
        },
        [dismiss],
    );

    const confirm = useCallback<FeedbackApi['confirm']>(
        (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
        [],
    );

    const settle = (ok: boolean) => {
        pending?.resolve(ok);
        setPending(null);
    };

    return (
        <FeedbackContext.Provider value={{ toast, confirm }}>
            {children}
            <div
                aria-live="polite"
                className="pointer-events-none fixed inset-x-0 top-14 z-[70] flex flex-col items-center gap-2 px-4 sm:left-auto sm:right-4 sm:items-end sm:px-0"
            >
                {toasts.map((t) => {
                    const Icon = toneIcon[t.tone];
                    return (
                        <div
                            key={t.id}
                            role={t.tone === 'error' ? 'alert' : 'status'}
                            className="animate-pop pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-tile bg-elevated px-3.5 py-2.5 shadow-popover"
                        >
                            <Icon className={cn('mt-0.5 size-4 shrink-0', toneColor[t.tone])} strokeWidth={2} aria-hidden />
                            <div className="min-w-0">
                                <p className="text-body font-medium text-label">{t.title}</p>
                                {t.description && <p className="text-footnote text-label-2">{t.description}</p>}
                            </div>
                            {t.action && (
                                <Button
                                    size="sm"
                                    variant="plain"
                                    className="-my-0.5 ml-1"
                                    onClick={() => {
                                        dismiss(t.id);
                                        t.action?.onClick();
                                    }}
                                >
                                    {t.action.label}
                                </Button>
                            )}
                            <button
                                type="button"
                                aria-label="Dismiss"
                                onClick={() => dismiss(t.id)}
                                className="-mr-1 ml-0.5 rounded px-1 text-label-3 hover:text-label"
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
            <AlertDialog options={pending} onSettle={settle} />
        </FeedbackContext.Provider>
    );
}

/** Alert: a short question with a Cancel (default) and a clearly named action. */
function AlertDialog({ options, onSettle }: { options: ConfirmOptions | null; onSettle: (ok: boolean) => void }) {
    const ref = useRef<HTMLDialogElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const open = options !== null;

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
            cancelRef.current?.focus();
        } else if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            role="alertdialog"
            aria-labelledby="alert-title"
            aria-describedby="alert-message"
            onCancel={(e) => {
                e.preventDefault();
                onSettle(false);
            }}
            className="sheet m-auto w-[340px] max-w-[calc(100vw-24px)] rounded-sheet bg-elevated p-0 text-label shadow-sheet"
        >
            {options && (
                <div className="animate-sheet flex flex-col items-center px-5 pt-6 pb-4 text-center">
                    {options.destructive && (
                        <AlertTriangle className="mb-3 size-8 text-warning" strokeWidth={1.8} aria-hidden />
                    )}
                    <h2 id="alert-title" className="text-headline font-semibold">
                        {options.title}
                    </h2>
                    {options.message && (
                        <div id="alert-message" className="mt-1.5 text-footnote text-label-2">
                            {options.message}
                        </div>
                    )}
                    <div className="mt-5 grid w-full grid-cols-2 gap-2">
                        <Button ref={cancelRef} onClick={() => onSettle(false)}>
                            {options.cancelLabel ?? 'Cancel'}
                        </Button>
                        <Button variant={options.destructive ? 'destructive' : 'primary'} onClick={() => onSettle(true)}>
                            {options.confirmLabel}
                        </Button>
                    </div>
                </div>
            )}
        </dialog>
    );
}

/* ---------------------------------------------------------------------------------------------
 * Inline notice: status that belongs to a view (archived space, model mismatch, offline).
 * ------------------------------------------------------------------------------------------- */
export function Notice({
    tone = 'info',
    title,
    children,
    action,
    className,
}: {
    tone?: 'info' | 'warning' | 'error';
    title: string;
    children?: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    const Icon = tone === 'info' ? Info : tone === 'warning' ? AlertTriangle : XCircle;
    return (
        <div
            role={tone === 'info' ? 'status' : 'alert'}
            className={cn(
                'flex items-start gap-3 rounded-tile px-4 py-3',
                tone === 'warning' ? 'bg-warning-fill' : 'bg-fill',
                className,
            )}
        >
            <Icon
                className={cn('mt-0.5 size-[18px] shrink-0', tone === 'warning' ? 'text-warning' : tone === 'error' ? 'text-danger' : 'text-accent')}
                strokeWidth={1.9}
                aria-hidden
            />
            <div className="min-w-0 flex-1">
                <p className="text-body font-semibold text-label">{title}</p>
                {children && <div className="mt-1 text-body text-label-2">{children}</div>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    );
}
