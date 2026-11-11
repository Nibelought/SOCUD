"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useRouter } from 'next/navigation';
import type { components } from '@/lib/api/client';

type GraphNode = components['schemas']['GraphNodeDto'];
type GraphLink = components['schemas']['GraphLinkDto'];
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

export default function GraphVisualizer({ data }: { data: GraphData }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
    const router = useRouter();

    const[dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const[isCentered, setIsCentered] = useState(false);

    // Reliable size calculation via ResizeObserver
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

    // Center the camera only after the physics engine has placed the nodes
    const handleEngineStop = useCallback(() => {
        if (!isCentered && graphRef.current) {
            graphRef.current.zoomToFit(800, 50); // smooth 800 ms zoom with 50 px padding
            setIsCentered(true);
        }
    }, [isCentered]);

    const handleNodeClick = (node: NodeObject<GraphNode>) => {
        router.push(`/document/${node.id}`);
    };

    return (
        <div ref={containerRef} className="absolute inset-0 bg-slate-900 overflow-hidden cursor-crosshair">
            {dimensions.width > 0 && dimensions.height > 0 && (
                <ForceGraph2D
                    ref={graphRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    graphData={data}
                    nodeAutoColorBy="group" // color by spaceId
                    nodeRelSize={6}
                    d3VelocityDecay={0.3} // physics damping (keeps nodes from jittering forever)
                    onEngineStop={handleEngineStop} // triggers camera centering
                    onNodeClick={handleNodeClick}
                    nodeCanvasObjectMode={() => 'after'}
                    nodeCanvasObject={(node: NodeObject<GraphNode>, ctx, globalScale) => {
                        if (node.x === undefined || node.y === undefined) return; // not positioned yet
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