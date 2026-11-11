"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, type components } from '@/lib/api/client';
import { sessionLostLoginUrl } from "@/lib/auth";
import { graphTruncationNotice } from "@/lib/graphNotice";

// Must disable SSR
const DynamicGraph = dynamic(
    () => import("@/components/graph/GraphVisualizer"),
    { ssr: false, loading: () => <div className="flex justify-center items-center h-[80vh] text-slate-500"><Loader2 className="w-8 h-8 animate-spin" /></div> }
);

export default function KnowledgeGraphPage() {
    const router = useRouter();
    const [graphData, setGraphData] = useState<components["schemas"]["KnowledgeGraphDto"]>({ nodes: [], links: [], truncated: false });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem("socud_token");
        if (!token) return router.push(sessionLostLoginUrl());

        api.GET('/document/graph')
            .then(({ data }) => {
                // Previously the raw body was stored (an error body would crash the page); keep the page alive
                if (data) setGraphData(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [router]);

    const truncationNotice = graphTruncationNotice(graphData.truncated, graphData.nodes.length);

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* HEADER */}
            <header className="h-16 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-4 text-white">
                    <Link href="/dashboard" className="p-2 hover:bg-slate-800 rounded-md transition-colors text-slate-400 hover:text-white">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="font-bold text-lg">Knowledge Graph</h1>
                </div>

                <div className="text-sm text-slate-400">
                    <span className="text-white font-medium">{graphData.nodes.length}</span> Nodes
                    <span className="mx-2">•</span>
                    <span className="text-white font-medium">{graphData.links.length}</span> Edges
                </div>
            </header>

            {/* Graph */}
            <main className="flex-1 relative">
                {!loading && <DynamicGraph data={graphData} />}
                {truncationNotice && (
                    <p role="status" className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-slate-950/80 px-3 py-1 text-xs text-slate-400 pointer-events-none">
                        {truncationNotice}
                    </p>
                )}
            </main>
        </div>
    );
}