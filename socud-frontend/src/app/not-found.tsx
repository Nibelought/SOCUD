import Link from "next/link";
import { AppMark } from "@/components/shell/AppMark";

export default function NotFound() {
    return (
        <main className="flex min-h-dvh flex-col items-center justify-center bg-grouped px-6 text-center">
            <AppMark className="mb-5 size-12 rounded-[12px]" />
            <h1 className="text-title2 font-bold text-label">This page doesn’t exist</h1>
            <p className="mt-1.5 max-w-sm text-body text-label-2">The link may be mistyped, or the page was moved.</p>
            <Link href="/dashboard" className="mt-6 inline-flex h-8 items-center rounded-control bg-accent px-3 text-body font-medium text-on-accent hover:bg-accent-hover">
                Go Home
            </Link>
        </main>
    );
}
