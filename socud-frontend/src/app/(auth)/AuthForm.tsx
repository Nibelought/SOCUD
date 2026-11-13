"use client";

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppMark } from '@/components/shell/AppMark';

/** Frame of the sign-in and create-account screens: the mark, a title, one short form. */
export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
    return (
        <main className="flex min-h-dvh flex-col items-center bg-grouped px-4 pt-[14vh] pb-12">
            <div className="w-full max-w-[360px]">
                <div className="flex flex-col items-center text-center">
                    <AppMark className="size-14 rounded-[14px] shadow-tile" />
                    <h1 className="mt-5 text-title1 font-bold tracking-[-0.01em] text-label">{title}</h1>
                    <p className="mt-1.5 text-body text-label-2">{subtitle}</p>
                </div>
                <div className="mt-8">{children}</div>
                <p className="mt-6 text-center text-body text-label-2">{footer}</p>
            </div>
        </main>
    );
}

/** Fields grouped in one rounded container with hairline separators (an inset grouped list). */
export function FieldGroup({ children }: { children: ReactNode }) {
    return <div className="divide-y divide-separator overflow-hidden rounded-tile bg-elevated shadow-tile">{children}</div>;
}

export function GroupedInput({
    label,
    ...rest
}: { label: string } & React.ComponentProps<'input'>) {
    return (
        <label className="flex h-12 items-center gap-3 px-4 focus-within:bg-hover">
            <span className="w-[76px] shrink-0 text-body font-medium text-label">{label}</span>
            <input className="h-full min-w-0 flex-1 bg-transparent text-body text-label outline-none" {...rest} />
        </label>
    );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="font-medium text-accent hover:underline">
            {children}
        </Link>
    );
}
