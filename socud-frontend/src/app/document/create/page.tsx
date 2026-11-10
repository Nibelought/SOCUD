"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Loader2 } from "lucide-react";
import { api, apiErrorMessage, type components } from "@/lib/api/client";

type Space = components["schemas"]["SpaceWithCountDto"];

export default function CreateDocumentPage() {
    const router = useRouter();
    const [title, setTitle] = useState("");
    const [spaceId, setSpaceId] = useState("");
    const [spaces, setSpaces] = useState<Space[]>([]);
    const[error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const fetchSpaces = async () => {
            const token = localStorage.getItem("socud_token");
            if (!token) return router.push("/login");

            try {
                const { data, response } = await api.GET("/space/my");
                if (!response.ok || !data) throw new Error("Failed to load spaces");

                setSpaces(data);
                if (data.length > 0) setSpaceId(data[0].id); // Выбираем первое по умолчанию
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchSpaces();
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError("");

        try {
            // POST запрос к DocumentModule (из твоей Фазы 1: dto.title, dto.spaceId)
            const { data: doc, error } = await api.POST("/document", {
                body: { title, spaceId },
            });

            if (!doc) {
                throw new Error(apiErrorMessage(error, "Failed to create document"));
            }

            // Перенаправляем сразу в редактор свежесозданного документа
            router.push(`/document/${doc.id}`);
        } catch (err: any) {
            setError(err.message);
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8">
                <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                </Link>

                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center">
                        <FileText className="w-6 h-6" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800">Create Document</h1>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-md text-sm">{error}</div>}

                {spaces.length === 0 ? (
                    <div className="text-center p-6 border border-dashed border-slate-300 rounded-md">
                        <p className="text-slate-600 mb-4">You don&apos;t have any spaces yet. Documents must be placed inside a space.</p>
                        <Link href="/space/create" className="text-blue-600 font-medium hover:underline">
                            Create a Space first
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Document Title</label>
                            <input
                                type="text"
                                required
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Q3 Marketing Plan"
                                className="w-full border border-slate-300 rounded-md p-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Target Space</label>
                            <select
                                value={spaceId}
                                onChange={(e) => setSpaceId(e.target.value)}
                                className="w-full border border-slate-300 rounded-md p-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all bg-white"
                            >
                                {spaces.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !title.trim() || !spaceId}
                            className="w-full bg-blue-600 text-white p-2.5 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {submitting ? "Creating..." : "Create Document"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}