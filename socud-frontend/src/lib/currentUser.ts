/**
 * The signed-in person, read from the access token's payload (`sub`, `email`). Display only: the
 * token is verified by the API on every request, never here.
 */
export interface CurrentUser {
    id: string;
    email: string;
    /** Part of the email before "@", used as the display name until accounts have names. */
    name: string;
}

function decodeSegment(segment: string): unknown {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    // Payloads are UTF-8; atob gives Latin-1 code units.
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

export function userFromToken(token: string | null | undefined): CurrentUser | null {
    if (!token) return null;
    try {
        const payload = decodeSegment(token.split('.')[1] ?? '') as { sub?: unknown; email?: unknown };
        if (typeof payload.sub !== 'string') return null;
        const email = typeof payload.email === 'string' ? payload.email : '';
        return { id: payload.sub, email, name: email.split('@')[0] || 'You' };
    } catch {
        return null;
    }
}

/** Initials for avatars: "anna.kim@x" -> "AK", "bob@x" -> "B". */
export function initials(nameOrEmail: string): string {
    const local = nameOrEmail.split('@')[0];
    const parts = local.split(/[._\-\s]+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]!.toLocaleUpperCase());
    return letters.join('') || '?';
}

const PRESENCE_COLORS = ['#2f66d6', '#cc5a14', '#2b8f48', '#8646be', '#d63a3a', '#1c80a3', '#c93a73', '#5452cf'];

/** Stable color per person for avatars and collaboration cursors. */
export function personColor(key: string): string {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}
