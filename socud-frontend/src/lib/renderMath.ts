import katex from 'katex';
import { KATEX_OPTIONS } from './security';

const MATH_NODE_SELECTOR =
    '[data-type="inlineMath"], [data-type="displayMath"], [data-type="blockMath"], .math-inline, .math-display, .tiptap-math, [latex], [data-latex]';
const SKIP_TEXT_IN = '.katex, code, pre, [data-type="inlineMath"], [data-type="displayMath"]';
const DOLLAR_MATH = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g;

/**
 * Renders the math in published document HTML (already sanitized) with KaTeX:
 *  1. Tiptap math nodes (`data-type` / `data-latex` attributes);
 *  2. raw `$...$` / `$$...$$` left in text (documents published before the math extension).
 * Idempotent: nodes that already contain KaTeX output are skipped.
 */
export function renderMathIn(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>(MATH_NODE_SELECTOR).forEach((element) => {
        if (element.querySelector('.katex')) return;
        let latex = element.getAttribute('data-latex') || element.getAttribute('latex') || element.textContent || '';
        latex = latex.trim().replace(/^\$\$?/, '').replace(/\$\$?$/, '');
        if (!latex) return;

        const type = (element.getAttribute('data-type') || '').toLowerCase();
        const isDisplay =
            type.includes('display') ||
            type.includes('block') ||
            element.classList.contains('math-display') ||
            element.getAttribute('display') === 'true';
        try {
            katex.render(latex, element, { ...KATEX_OPTIONS, displayMode: isDisplay });
        } catch {
            // leave the source visible
        }
    });

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(SKIP_TEXT_IN)) continue;
        if (node.nodeValue?.includes('$')) textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
        const text = textNode.nodeValue ?? '';
        DOLLAR_MATH.lastIndex = 0;
        if (!DOLLAR_MATH.test(text)) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        for (const match of text.matchAll(DOLLAR_MATH)) {
            const index = match.index ?? 0;
            if (index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
            const source = match[0];
            const span = document.createElement('span');
            try {
                katex.render(source.replace(/^\$\$?|\$\$?$/g, '').trim(), span, {
                    ...KATEX_OPTIONS,
                    displayMode: source.startsWith('$$'),
                });
            } catch {
                span.textContent = source;
            }
            fragment.appendChild(span);
            lastIndex = index + source.length;
        }
        if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        textNode.replaceWith(fragment);
    }
}
