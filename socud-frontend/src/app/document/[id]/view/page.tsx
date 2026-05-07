"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";
import { ArrowLeft, Edit3, Loader2 } from "lucide-react";
import Link from "next/link";
import katex from 'katex';

interface DocumentData {
    id: string;
    title: string;
    contentHtml: string | null;
    updatedAt: string;
    space: { name: string };
}

export default function DocumentViewPage() {
    const params = useParams();
    const router = useRouter();
    const docId = params.id as string;

    const [doc, setDoc] = useState<DocumentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const articleRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const loadDocument = async () => {
            try {
                const res = await fetchWithAuth(`http://localhost:3000/document/${docId}`);
                if (!res.ok) throw new Error(res.status === 404 ? "Документ не найден" : "Нет доступа");
                const data = await res.json();
                setDoc(data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        loadDocument();
    }, [docId]);

    useEffect(() => {
        if (!doc?.contentHtml || !articleRef.current) return;

        // Откладываем выполнение на следующий цикл отрисовки (Event Loop),
        // чтобы браузер гарантированно построил DOM-дерево из innerHTML
        const timer = setTimeout(() => {
            const container = articleRef.current;
            if (!container) return;

            // --- ПРОХОД 1: Обработка официальных узлов Tiptap ---
            const mathNodes = container.querySelectorAll(
                '[data-type="inlineMath"], [data-type="displayMath"], [data-type="blockMath"], .math-inline, .math-display, .tiptap-math, [latex], [data-latex]'
            );

            mathNodes.forEach((el) => {
                const element = el as HTMLElement;
                if (element.querySelector('.katex')) return;

                let latex = element.getAttribute('data-latex') || element.getAttribute('latex') || element.textContent || '';
                latex = latex.trim().replace(/^\$\$?/, '').replace(/\$\$?$/, '');
                if (!latex) return;

                const typeAttr = element.getAttribute('data-type') || '';
                const isDisplay =
                    typeAttr.toLowerCase().includes('display') ||
                    typeAttr.toLowerCase().includes('block') ||
                    element.classList.contains('math-display') ||
                    element.getAttribute('display') === 'true';

                try {
                    katex.render(latex, element, {
                        displayMode: isDisplay,
                        throwOnError: false,
                        trust: true,
                        strict: false,
                    });
                } catch (err) {
                    console.warn('[KaTeX Node] Render error:', err);
                }
            });

            // --- ПРОХОД 2: Обработка "сырого" текста (Fallback) ---
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
            const textNodes: Text[] =[];
            let node;

            while ((node = walker.nextNode())) {
                if (node.parentElement?.closest('.katex, code, pre, [data-type="inlineMath"],[data-type="displayMath"]')) continue;
                textNodes.push(node as Text);
            }

            textNodes.forEach(textNode => {
                const text = textNode.nodeValue || '';
                if (!text.includes('$')) return;

                const regex = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g;
                if (!regex.test(text)) return;

                const fragment = document.createDocumentFragment();
                let lastIndex = 0;

                text.replace(regex, (match, formula, index) => {
                    if (index > lastIndex) {
                        fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
                    }

                    const isDisplay = match.startsWith('$$');
                    const cleanLatex = match.replace(/^\$\$?|\$\$?$/g, '').trim();

                    const span = document.createElement('span');
                    try {
                        katex.render(cleanLatex, span, {
                            displayMode: isDisplay,
                            throwOnError: false,
                            trust: true,
                            strict: false,
                        });
                    } catch(e) {
                        span.textContent = match;
                    }
                    fragment.appendChild(span);

                    lastIndex = index + match.length;
                    return match;
                });

                if (lastIndex < text.length) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                }

                textNode.replaceWith(fragment);
            });
        }, 20); // 20 мс достаточно для завершения Paint/Layout операции браузера

        return () => clearTimeout(timer); // Очистка таймера при размонтировании
    },[doc?.contentHtml]);

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
    );

    if (error || !doc) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-800 p-6">
            <h2 className="text-xl font-bold text-red-600 mb-2">Ошибка загрузки</h2>
            <p className="text-slate-500 mb-6">{error}</p>
            <Link href="/dashboard" className="text-blue-600 hover:underline">← Вернуться на Dashboard</Link>
        </div>
    );

    return (
        <div className="min-h-screen bg-white">
            <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard" className="text-slate-500 hover:text-blue-600 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">{doc.title}</h1>
                        <p className="text-xs text-slate-500">
                            Space: {doc.space?.name || "Unknown"} • Updated at: {new Date(doc.updatedAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => router.push(`/document/${docId}`)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm"
                >
                    <Edit3 className="w-4 h-4" /> Edit
                </button>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-10">
                <article
                    ref={articleRef}
                    className="prose prose-slate prose-lg max-w-none focus:outline-none break-words"
                    dangerouslySetInnerHTML={{
                        __html: doc.contentHtml && doc.contentHtml.trim() !== ''
                            ? doc.contentHtml
                            : '<p class="text-slate-400 italic">Документ пустий або його не опубліковано. Натисніть, будь ласка, Publish в редакторі.</p>'
                    }}
                />
            </main>
        </div>
    );
}