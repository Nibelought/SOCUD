"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { renderMathIn } from '@/lib/renderMath';
import { sanitizeDocumentHtml } from '@/lib/security';
import { cn } from '@/lib/cn';
import { SpaceIcon } from '@/components/ui/Bits';

/** "▣ Space › Document" path in the toolbar; the space links back to its list. */
export function Breadcrumb({ spaceId, spaceName, title }: { spaceId?: string; spaceName?: string; title?: ReactNode }) {
    const showTitle = !!title;
    return (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-body">
            {spaceName && (
                <>
                    {spaceId ? (
                        <Link href={`/space/${spaceId}`} className="flex min-w-0 shrink items-center gap-1.5 rounded-control px-1.5 py-1 text-label-2 hover:bg-hover hover:text-label">
                            <SpaceIcon id={spaceId} name={spaceName} size="xs" />
                            <span className="max-w-[16ch] truncate">{spaceName}</span>
                        </Link>
                    ) : (
                        <span className="max-w-[16ch] truncate px-1.5 text-label-2">{spaceName}</span>
                    )}
                    {showTitle && <ChevronRight className="size-3.5 shrink-0 text-label-3" aria-hidden />}
                </>
            )}
            {showTitle && (
                <span aria-current="page" className="min-w-0 truncate px-1 font-semibold text-label">
                    {title}
                </span>
            )}
        </nav>
    );
}

/**
 * Published document HTML: sanitized here (stored HTML may predate server-side sanitizing), then
 * math rendered with KaTeX. Uses the same .doc-content styles as the editor.
 */
export function PublishedContent({ html, className }: { html: string; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const safeHtml = useMemo(() => (html.trim() ? sanitizeDocumentHtml(html) : ''), [html]);

    useEffect(() => {
        if (ref.current && safeHtml) renderMathIn(ref.current);
    }, [safeHtml]);

    return <div ref={ref} className={cn('doc-content', className)} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
