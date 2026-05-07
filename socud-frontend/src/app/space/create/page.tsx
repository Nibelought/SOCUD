"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shield, ArrowLeft } from "lucide-react";

export default function CreateSpacePage() {
    const router = useRouter();
    const [name, setName] = useState("");
    const[description, setDescription] = useState(""); // FIX: Состояние для описания
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const token = localStorage.getItem("socud_token");
        if (!token) return router.push("/login");

        try {
            const res = await fetch("http://localhost:3000/space", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ name, description }), // FIX: Передаем description (без userId!)
            });

            if (!res.ok) {
                const data = await res.json();
                // Улучшенная обработка массива ошибок от NestJS
                const errMsg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
                throw new Error(errMsg || "Failed to create space");
            }

            router.push("/dashboard");
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8">
                <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                </Link>

                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
                        <Shield className="w-6 h-6" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800">Create New Space</h1>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-md text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Space Name</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Engineering Knowledge Base"
                            className="w-full border border-slate-300 rounded-md p-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                    </div>

                    {/* FIX: Поле Description */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What is this space about?"
                            rows={3}
                            className="w-full border border-slate-300 rounded-md p-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !name.trim()}
                        className="w-full bg-blue-600 text-white p-2.5 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? "Creating..." : "Create Space"}
                    </button>
                </form>
            </div>
        </div>
    );
}