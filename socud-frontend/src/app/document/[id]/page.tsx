"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const DynamicEditor = dynamic(
    () => import("@/components/editor/DocumentEditor"),
    { ssr: false }
);

export default function DocumentPage() {
    const router = useRouter();
    const params = useParams();
    const documentId = params.id as string;

    const [token, setToken] = useState<string | null>(null);
    const [userName, setUserName] = useState("Unknown");
    const [currentUserId, setCurrentUserId] = useState("");

    useEffect(() => {
        const storedToken = localStorage.getItem("socud_token");
        if (!storedToken) {
            router.push("/login");
            return;
        }
        setToken(storedToken);

        try {
            const payload = JSON.parse(atob(storedToken.split('.')[1]));
            setUserName(payload.email.split('@')[0]);
            setCurrentUserId(payload.sub); // ← Извлекаем ID пользователя
        } catch {
            setUserName(`User-${Math.floor(Math.random() * 1000)}`);
        }
    }, [router]);

    if (!token) return null;

    const userColor = "#" + Math.floor(
        Math.abs(Math.sin(userName.charCodeAt(0)) * 16777215)
    ).toString(16).padEnd(6, '0');

    return (
        // ✅ Фиксированная высота экрана + flex для растягивания редактора
        <div className="h-screen bg-slate-100 p-4 flex flex-col overflow-hidden">
            <div className="max-w-7xl mx-auto w-full flex flex-col h-full">
                <div className="mb-3 flex items-center justify-between shrink-0">
                    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Dashboard
                    </Link>
                    <span className="text-xs text-slate-400 font-mono bg-slate-200 px-2 py-1 rounded">
                        ID: {documentId}
                    </span>
                </div>

                {/* Контейнер редактора занимает всё оставшееся пространство */}
                <div className="flex-1 min-h-0">
                    <DynamicEditor
                        documentId={documentId}
                        token={token}
                        userName={userName}
                        userColor={userColor}
                        currentUserId={currentUserId}
                    />
                </div>
            </div>
        </div>
    );
}