"use client";
"use no memo";

import { useRef, useEffect, useState, useCallback } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { useRouter } from 'next/navigation';

interface GraphData {
    nodes: { id: string; name: string; group: string; spaceName: string }[];
    links: { source: string; target: string }[];
}

export default function GraphVisualizer({ data }: { data: GraphData }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<ForceGraphMethods>();
    const router = useRouter();

    const[dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const[isCentered, setIsCentered] = useState(false);

    // FIX 1: Надежный расчет размеров через ResizeObserver
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setDimensions({ width, height });
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    },[]);

    // FIX 2: Центрируем камеру только после того, как физический движок расставил узлы
    const handleEngineStop = useCallback(() => {
        if (!isCentered && graphRef.current) {
            graphRef.current.zoomToFit(800, 50); // Плавный зум 800ms с отступом 50px
            setIsCentered(true);
        }
    }, [isCentered]);

    const handleNodeClick = (node: any) => {
        router.push(`/document/${node.id}`);
    };

    return (
        <div ref={containerRef} className="absolute inset-0 bg-slate-900 overflow-hidden cursor-crosshair">
            {dimensions.width > 0 && dimensions.height > 0 && (
                <ForceGraph2D
                    ref={graphRef as any}
                    width={dimensions.width}
                    height={dimensions.height}
                    graphData={data}
                    nodeAutoColorBy="group" // Раскраска по spaceId
                    nodeRelSize={6}
                    d3VelocityDecay={0.3} // Затухание физики (чтобы узлы не дрожали бесконечно)
                    onEngineStop={handleEngineStop} // Триггер центрирования камеры
                    onNodeClick={handleNodeClick}
                    nodeCanvasObjectMode={() => 'after'}
                    nodeCanvasObject={(node: any, ctx, globalScale) => {
                        const label = node.name;
                        const fontSize = 12 / globalScale;
                        ctx.font = `${fontSize}px Sans-Serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                        ctx.fillText(label, node.x, node.y + 12);
                    }}
                    linkColor={() => 'rgba(148, 163, 184, 0.4)'}
                    linkWidth={1.5}
                    linkDirectionalParticles={2}
                    linkDirectionalParticleSpeed={0.005}
                />
            )}
        </div>
    );
}