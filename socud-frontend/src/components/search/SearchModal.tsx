"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Loader2, Sparkles, Text, ArrowRight, FileText } from "lucide-react";

interface SearchResult {
    id: string;
    title: string;
    space: string;
    snippet: string;
    type: 'semantic' | 'keyword';
    score: number | null;
}

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Автофокус при открытии
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
            document.body.style.overflow = "hidden"; // Блокируем скролл страницы
        } else {
            document.body.style.overflow = "auto";
            setQuery("");
            setResults([]);
        }
        return () => { document.body.style.overflow = "auto"; };
    }, [isOpen]);

    // Закрытие по Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Debounce и Fetch логика
    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const delayDebounceFn = setTimeout(async () => {
            try {
                const token = localStorage.getItem("socud_token");
                const res = await fetch(`http://localhost:3000/document/search?q=${encodeURIComponent(query)}`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });

                if (res.ok) {
                    const data = await res.json();
                    setResults(data);
                }
            } catch (err) {
                console.error("Search failed:", err);
            } finally {
                setLoading(false);
            }
        }, 500); // 500ms задержка

        return () => clearTimeout(delayDebounceFn);
    }, [query]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-slate-900/50 backdrop-blur-sm px-4">
            {/* Клик по фону для закрытия */}
            <div className="absolute inset-0" onClick={onClose}></div>

            <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
                {/* Search Input Header */}
                <div className="flex items-center px-4 py-4 border-b border-slate-100">
                    <Search className="w-5 h-5 text-slate-400 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ask AI or search by keywords..."
                        className="flex-1 bg-transparent border-none outline-none px-4 text-lg text-slate-800 placeholder-slate-400"
                    />
                    {loading && <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />}
                    <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-md ml-2">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Results Body */}
                <div className="overflow-y-auto flex-1 p-2">
                    {query.trim() && !loading && results.length === 0 && (
                        <div className="p-8 text-center text-slate-500">
                            No knowledge found matching "{query}".
                        </div>
                    )}

                    {results.map((result) => (
                        <div
                            key={result.id}
                            onClick={() => {
                                onClose();
                                router.push(`/documents/${result.id}`);
                            }}
                            className="group flex flex-col p-3 mx-2 my-1 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors"
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-blue-600" />
                                    <h3 className="font-semibold text-slate-800 group-hover:text-blue-700 transition-colors">
                                        {result.title}
                                    </h3>
                                    <span className="text-xs text-slate-400 px-2 py-0.5 bg-slate-100 rounded-md">
                                        {result.space}
                                    </span>
                                </div>

                                {/* Баджи типа поиска */}
                                {result.type === 'semantic' ? (
                                    <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase text-purple-600 bg-purple-100 px-2 py-1 rounded-md">
                                        <Sparkles className="w-3 h-3" /> AI Semantic {result.score && `(${(result.score * 100).toFixed(0)}%)`}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                                        <Text className="w-3 h-3" /> Keyword
                                    </span>
                                )}
                            </div>

                            <p className="text-sm text-slate-500 line-clamp-2 mt-1">
                                {result.snippet}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between items-center">
                    <span>Press <kbd className="font-sans px-1.5 py-0.5 bg-slate-200 rounded text-slate-600">Esc</kbd> to close</span>
                    <span className="flex items-center gap-1">Powered by <Sparkles className="w-3 h-3 text-purple-500" /> E5</span>
                </div>
            </div>
        </div>
    );
}