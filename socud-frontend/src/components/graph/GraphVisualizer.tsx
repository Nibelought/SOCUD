"use client";
"use no memo";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { spaceColorHex } from '@/lib/spaceColor';

export interface GraphNode {
    id: string;
    name: string;
    group: string;
    spaceName: string;
}
export interface GraphData {
    nodes: GraphNode[];
    links: { source: string; target: string }[];
}

export interface GraphControls {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
}

type Node = NodeObject<GraphNode & { degree: number }>;
type Link = LinkObject<GraphNode & { degree: number }, object>;

interface Props {
    data: GraphData;
    scheme: 'light' | 'dark';
    onOpen: (id: string) => void;
    /** Space to emphasise (others are dimmed), from the legend. */
    focusSpace?: string | null;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/**
 * Force-directed map of documents (nodes, colored by space and sized by connections) and the links
 * between them. Hovering a node highlights its neighbors; clicking opens the document.
 */
const GraphVisualizer = forwardRef<GraphControls, Props>(function GraphVisualizer({ data, scheme, onOpen, focusSpace }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<ForceGraphMethods<Node, Link> | undefined>(undefined);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [hovered, setHovered] = useState<Node | null>(null);
    const fitted = useRef(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Copy: the library mutates nodes and links (positions, object references).
    const graph = useMemo(() => {
        const degree = new Map<string, number>();
        for (const l of data.links) {
            degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
            degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
        }
        return {
            nodes: data.nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })),
            links: data.links.map((l) => ({ ...l })),
        };
    }, [data]);

    const neighbors = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const l of data.links) {
            if (!map.has(l.source)) map.set(l.source, new Set());
            if (!map.has(l.target)) map.set(l.target, new Set());
            map.get(l.source)!.add(l.target);
            map.get(l.target)!.add(l.source);
        }
        return map;
    }, [data]);

    const css = useCallback(
        (name: string, fallback: string) => {
            if (typeof window === 'undefined') return fallback;
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the appearance changes
        [scheme],
    );
    const labelColor = css('--c-label', scheme === 'dark' ? '#f5f5f7' : '#1d1d1f');
    const secondaryColor = css('--c-label-2', '#6e6e73');
    const linkColor = scheme === 'dark' ? 'rgba(160,160,170,0.28)' : 'rgba(60,60,67,0.2)';
    const linkHighlight = scheme === 'dark' ? 'rgba(235,235,245,0.75)' : 'rgba(29,29,31,0.6)';

    const isActive = useCallback(
        (node: Node) => {
            if (hovered) return node.id === hovered.id || !!neighbors.get(hovered.id as string)?.has(node.id as string);
            if (focusSpace) return node.group === focusSpace;
            return true;
        },
        [hovered, neighbors, focusSpace],
    );

    // Keep the map compact: weaker, short-range repulsion so unlinked documents don't drift off.
    const ready = size.width > 0 && size.height > 0;
    useEffect(() => {
        const fg = graphRef.current;
        if (!ready || !fg) return;
        const charge = fg.d3Force('charge') as unknown as { strength: (s: number) => { distanceMax: (d: number) => void } } | undefined;
        charge?.strength(-60).distanceMax(220);
        fg.d3ReheatSimulation();
    }, [graph, ready]);

    useImperativeHandle(ref, () => ({
        zoomIn: () => graphRef.current?.zoom((graphRef.current?.zoom() ?? 1) * 1.4, 250),
        zoomOut: () => graphRef.current?.zoom((graphRef.current?.zoom() ?? 1) / 1.4, 250),
        fit: () => graphRef.current?.zoomToFit(400, 60),
    }));

    const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return (
        <div ref={containerRef} className="absolute inset-0" style={{ cursor: hovered ? 'pointer' : 'grab' }}>
            {size.width > 0 && size.height > 0 && (
                <ForceGraph2D<GraphNode & { degree: number }, object>
                    ref={graphRef}
                    width={size.width}
                    height={size.height}
                    graphData={graph}
                    backgroundColor="rgba(0,0,0,0)"
                    nodeRelSize={4}
                    nodeVal={(n) => 1 + Math.min(n.degree, 12) * 0.6}
                    nodeLabel={() => ''}
                    d3VelocityDecay={0.32}
                    cooldownTicks={reduceMotion ? 0 : undefined}
                    cooldownTime={3000}
                    warmupTicks={reduceMotion ? 120 : 0}
                    onEngineStop={() => {
                        if (!fitted.current) {
                            fitted.current = true;
                            graphRef.current?.zoomToFit(reduceMotion ? 0 : 600, 60);
                        }
                    }}
                    onNodeHover={(n) => setHovered((n as Node) ?? null)}
                    onNodeClick={(n) => onOpen(String((n as Node).id))}
                    linkColor={(l) => {
                        const s = (l as Link).source as Node;
                        const t = (l as Link).target as Node;
                        if (hovered && (s.id === hovered.id || t.id === hovered.id)) return linkHighlight;
                        return linkColor;
                    }}
                    linkWidth={(l) => {
                        const s = (l as Link).source as Node;
                        const t = (l as Link).target as Node;
                        return hovered && (s.id === hovered.id || t.id === hovered.id) ? 1.6 : 1;
                    }}
                    linkDirectionalArrowLength={3}
                    linkDirectionalArrowRelPos={0.92}
                    nodeCanvasObject={(node, ctx, scale) => {
                        const n = node as Node;
                        const r = Math.sqrt(1 + Math.min(n.degree, 12) * 0.6) * 4;
                        const active = isActive(n);
                        ctx.globalAlpha = active ? 1 : 0.18;
                        ctx.beginPath();
                        ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
                        ctx.fillStyle = spaceColorHex(n.group, scheme);
                        ctx.fill();
                        if (hovered?.id === n.id) {
                            ctx.lineWidth = 2 / scale;
                            ctx.strokeStyle = labelColor;
                            ctx.stroke();
                        }
                        // Labels: always for the hovered node and its neighbors, otherwise once zoomed in.
                        const showLabel = (hovered && active) || scale > 1.6 || graph.nodes.length <= 25;
                        if (showLabel && active) {
                            const size = Math.max(11, 12.5) / scale;
                            ctx.font = `${hovered?.id === n.id ? 600 : 500} ${size}px ${FONT}`;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'top';
                            const label = n.name.length > 40 ? `${n.name.slice(0, 38)}…` : n.name;
                            ctx.fillStyle = hovered?.id === n.id ? labelColor : secondaryColor;
                            ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + r + 3 / scale);
                        }
                        ctx.globalAlpha = 1;
                    }}
                    nodePointerAreaPaint={(node, color, ctx) => {
                        const n = node as Node;
                        const r = Math.sqrt(1 + Math.min(n.degree, 12) * 0.6) * 4 + 3;
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
                        ctx.fill();
                    }}
                />
            )}
            {hovered && (
                <div className="material-floating pointer-events-none absolute bottom-4 left-1/2 max-w-[80%] -translate-x-1/2 rounded-full px-3.5 py-1.5 text-footnote text-label">
                    <span className="font-semibold">{hovered.name}</span>
                    <span className="text-label-2">
                        {' '}
                        in {hovered.spaceName}, {hovered.degree} {hovered.degree === 1 ? 'link' : 'links'}
                    </span>
                </div>
            )}
        </div>
    );
});

export default GraphVisualizer;
