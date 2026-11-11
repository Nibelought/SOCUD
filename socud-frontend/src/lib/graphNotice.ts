/** Notice shown on the graph page when the backend capped the node list (`truncated: true`). */
export function graphTruncationNotice(truncated: boolean | undefined, nodeCount: number): string | null {
    if (!truncated) return null;
    return `Showing the first ${nodeCount.toLocaleString('en-US')} pages`;
}
