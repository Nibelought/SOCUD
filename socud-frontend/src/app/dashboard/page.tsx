"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    Search, ChevronDown, User, Plus,
    Shield, Book, Folder, FileText, Edit
} from "lucide-react";
import { Share2 } from "lucide-react";
import SearchModal from "@/components/search/SearchModal";
import { fetchWithAuth } from '@/lib/auth';

// Типы ожидаемых данных с бэкенда
interface Space {
    id: string;
    name: string;
    _count?: { documents: number };
}

interface Activity {
    id: string;
    title: string;
    updatedAt: string;
    space: { name: string };
    updatedBy: string;
    createdBy: string;
}

export default function DashboardPage() {
    const router = useRouter();
    const [userName, setUserName] = useState("Loading...");
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);

    // FIX: Состояние для модального окна поиска
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    // FIX: Добавление хоткея Ctrl+K / Cmd+K
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsSearchOpen(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    },[]);

    useEffect(() => {
        const token = localStorage.getItem("socud_token");
        if (!token) {
            router.push("/login");
            return;
        }

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUserName(payload.email.split('@')[0]);
        } catch {
            setUserName("User");
        }

        // Параллельный запрос данных
        Promise.all([
            fetchWithAuth("http://localhost:3000/space/my").then(res => res.json()),
            fetchWithAuth("http://localhost:3000/document/recent").then(res => res.json())
        ])
            .then(([spacesData, activityData]) => {
                setSpaces(Array.isArray(spacesData) ? spacesData :[]);
                setActivities(Array.isArray(activityData) ? activityData :[]);
            })
            .catch(console.error)
            .finally(() => setLoading(false));

    }, [router]);

    // Простой маппинг иконок в зависимости от длины названия (для визуального разнообразия)
    const getSpaceStyle = (name: string) => {
        const char = name.length % 3;
        if (char === 0) return { icon: Shield, color: "text-blue-600", bg: "bg-blue-100" };
        if (char === 1) return { icon: Book, color: "text-slate-600", bg: "bg-slate-100" };
        return { icon: Folder, color: "text-blue-500", bg: "bg-blue-50" };
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading dashboard...</div>;

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
            {/* HEADER */}
            <header className="bg-blue-50 border-b border-blue-100 h-16 flex items-center justify-between px-6 sticky top-0 z-10">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 text-blue-700 font-bold text-xl tracking-tight">
                        <div className="border-2 border-blue-700 p-1 rounded-sm">
                            <span className="leading-none">SOCUD</span>
                        </div>
                    </div>
                    <button className="flex items-center gap-1 text-sm font-medium hover:text-blue-700 transition-colors">
                        SPACES <ChevronDown className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 max-w-xl px-6">
                    <button
                        onClick={() => setIsSearchOpen(true)}
                        className="relative w-full flex items-center justify-between pl-3 pr-4 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-400 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-text"
                    >
                        <div className="flex items-center gap-2">
                            <Search className="w-4 h-4" />
                            <span>Search KMS...</span>
                        </div>
                        <kbd className="hidden sm:inline-block font-sans text-[10px] font-medium px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-500">
                            Ctrl K
                        </kbd>
                    </button>
                </div>

                <div className="flex items-center gap-2 cursor-pointer hover:bg-blue-100 p-2 rounded-md transition-colors" onClick={() => {
                    localStorage.removeItem("socud_token");
                    router.push("/login");
                }}>
                    <div className="w-8 h-8 bg-slate-300 rounded-full flex items-center justify-center text-slate-600">
                        <User className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-medium text-red-600 hover:text-red-700">Logout</span>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

                {/* WELCOME BANNER */}
                <div className="bg-blue-50 rounded-xl p-8 flex items-center justify-between border border-blue-100 shadow-sm">
                    <h1 className="text-3xl font-semibold text-slate-800">
                        Welcome back, <span className="text-blue-700 capitalize">{userName}</span>!
                    </h1>
                    <div className="flex gap-2">
                        {/* Новая кнопка графа */}
                        <button
                            onClick={() => router.push('/graph')}
                            className="bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 px-4 py-2.5 rounded-md font-medium flex items-center gap-2 transition-colors shadow-sm"
                        >
                            <Share2 className="w-5 h-5" /> Graph
                        </button>
                        <button
                            onClick={() => router.push('/document/create')}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-md font-medium flex items-center gap-2 transition-colors shadow-sm"
                        >
                            <Plus className="w-5 h-5" /> Create Knowledge
                        </button>
                    </div>
                </div>

                {/* YOUR SPACES */}
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-semibold">Your Spaces</h2>
                        <Link href="/space/create" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                            <Plus className="w-4 h-4" /> New Space
                        </Link>
                    </div>
                    {spaces.length === 0 ? (
                        <div className="text-slate-500 bg-white border border-slate-200 p-6 rounded-xl text-center">No spaces found. Create one!</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {spaces.map((space) => {
                                const style = getSpaceStyle(space.name);
                                const Icon = style.icon;
                                return (
                                    <div
                                        key={space.id}
                                        onClick={() => router.push(`/space/${space.id}`)}
                                        className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-blue-200 transition-all flex flex-col justify-between group cursor-pointer"
                                    >
                                        <div className="flex gap-4">
                                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${style.bg} ${style.color}`}>
                                                <Icon className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">{space.name}</h3>
                                                <p className="text-sm text-slate-500">{space._count?.documents || 0} pages</p>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* ACTIVITY (FULL WIDTH NOW) */}
                <div>
                    <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        {activities.length === 0 ? (
                            <div className="p-6 text-center text-slate-500">No recent activity.</div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {activities.map((act) => {
                                    const isCreated = act.updatedAt === act.createdBy; // Эвристика: если не обновлялся, значит создан
                                    const actionText = isCreated ? "Created document" : "Updated document";
                                    const date = new Date(act.updatedAt).toLocaleDateString();

                                    return (
                                        <div key={act.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-4 w-2/5">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                                                    {act.updatedBy ? "U" : "U"}
                                                </div>
                                                <div className="flex items-center gap-2 text-slate-600 truncate">
                                                    {isCreated ? <FileText className="w-4 h-4 shrink-0" /> : <Edit className="w-4 h-4 shrink-0" />}
                                                    <span className="truncate">{actionText}</span>
                                                </div>
                                            </div>
                                            <div className="w-2/5 flex items-center gap-2 text-blue-600 font-medium truncate px-2 cursor-pointer hover:underline" onClick={() => router.push(`/document/${act.id}/view`)}>
                                                <FileText className="w-4 h-4 shrink-0" />
                                                <span className="truncate">{act.title}</span>
                                            </div>
                                            <div className="w-1/5 flex items-center justify-end gap-6 text-slate-500">
                                                <span className="truncate hidden sm:block">{act.space?.name || "Unknown Space"}</span>
                                                <span className="whitespace-nowrap w-24 text-right">{date}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

            </main>

            {/* FIX: Внедрение поисковой модалки */}
            <SearchModal
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
            />
        </div>
    );
}