/**
 * Every space has a color. It appears wherever the space does (sidebar, tiles, breadcrumbs, graph
 * nodes), so people learn to recognize a space by it, the way Calendar and Reminders color their
 * lists. Spaces have no stored color yet, so it is derived from the id: stable across sessions and
 * devices, with no backend change. When the API gains a color field, pass it as `override`.
 *
 * The CSS values live in globals.css (`--space-<name>`, light and dark).
 */
export const SPACE_COLOR_NAMES = [
    'blue', 'orange', 'green', 'purple', 'red', 'teal',
    'yellow', 'indigo', 'pink', 'mint', 'brown', 'graphite',
] as const;

export type SpaceColorName = (typeof SPACE_COLOR_NAMES)[number];

/** Hex values for canvas drawing (the graph), mirroring globals.css. */
export const SPACE_COLOR_HEX: Record<SpaceColorName, { light: string; dark: string }> = {
    red: { light: '#d63a3a', dark: '#ef6b6b' },
    orange: { light: '#cc5a14', dark: '#f0873f' },
    yellow: { light: '#a67c00', dark: '#d6a92a' },
    green: { light: '#2b8f48', dark: '#4cbb6c' },
    mint: { light: '#0f8a7e', dark: '#3cc2b4' },
    teal: { light: '#1c80a3', dark: '#4bb0d4' },
    blue: { light: '#2f66d6', dark: '#6e98f0' },
    indigo: { light: '#5452cf', dark: '#8d8bf0' },
    purple: { light: '#8646be', dark: '#b884e6' },
    pink: { light: '#c93a73', dark: '#ec6fa0' },
    brown: { light: '#8e6240', dark: '#c09170' },
    graphite: { light: '#63636b', dark: '#9a9aa2' },
};

/** FNV-1a: small, fast and well spread for short ids. */
function hash(value: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export function spaceColorName(spaceId: string, override?: string | null): SpaceColorName {
    if (override && (SPACE_COLOR_NAMES as readonly string[]).includes(override)) {
        return override as SpaceColorName;
    }
    return SPACE_COLOR_NAMES[hash(spaceId) % SPACE_COLOR_NAMES.length];
}

/** CSS value for inline styles: `style={spaceTint(id)}` sets `--tint`, used by `bg-tint` / `text-tint`. */
export function spaceTint(spaceId: string): React.CSSProperties {
    return { ['--tint' as string]: `var(--space-${spaceColorName(spaceId)})` };
}

export function spaceColorHex(spaceId: string, scheme: 'light' | 'dark'): string {
    return SPACE_COLOR_HEX[spaceColorName(spaceId)][scheme];
}

/** First letter of a space name for its tile ("Research notes" -> "R"), skipping a leading tag ("[Demo] Maths" -> "M"). */
export function spaceInitial(name: string): string {
    const untagged = name.trim().replace(/^(\[[^\]]*\]|\([^)]*\))\s*/u, '');
    const letter = (untagged || name).match(/\p{L}|\p{N}/u)?.[0];
    return (letter ?? '·').toLocaleUpperCase();
}
