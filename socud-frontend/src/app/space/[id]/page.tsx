"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Plus, Shield, Loader2, Edit, Settings } from "lucide-react";
import AccessManagerModal from "@/components/modals/AccessManagerModal";

interface Document {
    id: string;
    title: string;
    updatedAt: string;
}

interface Space {
    id: string;
    title: string;
    documents: Document[];
}

export default function SpaceDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const spaceId = params.id as string;

    const [space, setSpace] = useState<Space | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [currentUserId, setCurrentUserId] = useState("");

    useEffect(() => {
        const token = localStorage.getItem("socud_token");
        if (!token) return router.push("/login");

        // Извлекаем ID текущего пользователя из JWT
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setCurrentUserId(payload.sub);
        } catch (e) {
            console.error("Invalid token");
            return router.push("/login");
        }

        fetch(`http://localhost:3000/space/${spaceId}`, {
            headers: { "Authorization": `Bearer ${token}` }
        })
            .then(async (res) => {
                if (!res.ok) throw new Error("Failed to load space or access denied");
                return res.json();
            })
            .then((data) => {
                setSpace(data);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, [spaceId, router]);

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

    if (error || !space) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-800">
            <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
            <p className="text-slate-500 mb-4">{error}</p>
            <Link href="/dashboard" className="text-blue-600 hover:underline">Return to Dashboard</Link>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Хедер (Навигация) */}
                <div className="flex items-center justify-between">
                    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Dashboard
                    </Link>
                </div>

                {/* Шапка Пространства */}
                <div className="bg-white border border-slate-200 rounded-xl p-8 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                            <Shield className="w-8 h-8" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-800">{space.name}</h1>
                            <p className="text-slate-500 mt-1">{space.documents.length} pages</p>
                        </div>
                    </div>

                    {/* Кнопки управления */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-md font-medium flex items-center gap-2 transition-colors shadow-sm"
                        >
                            <Settings className="w-5 h-5" /> Settings
                        </button>
                        <button
                            onClick={() => router.push(`/document/create`)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-md font-medium flex items-center gap-2 transition-colors shadow-sm"
                        >
                            <Plus className="w-5 h-5" /> New Document
                        </button>
                    </div>
                </div>

                {/* Список документов */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h2 className="font-semibold text-slate-700">Documents in {space.name}</h2>
                    </div>

                    {space.documents.length === 0 ? (
                        <div className="p-12 text-center text-slate-500 flex flex-col items-center">
                            <FileText className="w-12 h-12 text-slate-300 mb-3" />
                            <p>This space is empty.</p>
                            <p className="text-sm">Create the first document to start building your knowledge base.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {space.documents.map((doc) => (
                                <div
                                    key={doc.id}
                                    onClick={() => router.push(`/document/${doc.id}/view`)}
                                    className="p-4 px-6 hover:bg-blue-50 transition-colors flex items-center justify-between group cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 rounded-md transition-colors">
                                            <FileText className="w-5 h-5" />
                                        </div>
                                        <span className="font-medium text-slate-800 group-hover:text-blue-700 transition-colors">
                                            {doc.title}
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-400 flex items-center gap-4">
                                        <span className="hidden sm:inline-flex items-center gap-1">
                                            <Edit className="w-3 h-3" /> Updated {new Date(doc.updatedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>

            {/* Модальное окно управления доступом */}
            <AccessManagerModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                entityId={spaceId}
                entityType="space"
                currentUserId={currentUserId}
                onDeleteSuccess={() => router.push('/dashboard')}
            />
        </div>
    );
}