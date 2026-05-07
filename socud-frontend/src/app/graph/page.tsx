"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchWithAuth } from '@/lib/auth';

// КРИТИЧЕСКИ ВАЖНО: Отключаем SSR
const DynamicGraph = dynamic(
    () => import("@/components/graph/GraphVisualizer"),
    { ssr: false, loading: () => <div className="flex justify-center items-center h-[80vh] text-slate-500"><Loader2 className="w-8 h-8 animate-spin" /></div> }
);

export default function KnowledgeGraphPage() {
    const router = useRouter();
    const [graphData, setGraphData] = useState({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem("socud_token");
        if (!token) return router.push("/login");

        fetchWithAuth("http://localhost:3000/document/graph")
            .then(res => res.json())
            .then(data => {
                setGraphData(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [router]);

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

            {/* ГРАФ */}
            <main className="flex-1 relative">
                {!loading && <DynamicGraph data={graphData} />}
            </main>
        </div>
    );
}