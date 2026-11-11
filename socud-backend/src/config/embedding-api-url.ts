import { isIP } from 'node:net';

export const DEFAULT_EMBEDDING_API_URL = 'https://openrouter.ai/api/v1';

export type UrlAssessment =
  | { ok: true; url: URL; warning?: string }
  | { ok: false; error: string };

function ipv4Octets(host: string): number[] | undefined {
  if (isIP(host) !== 4) return undefined;
  return host.split('.').map(Number);
}

/** 127/8 and ::1 and `localhost`. */
export function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4Octets(host);
  if (v4) return v4[0] === 127;
  return host === '::1';
}

/**
 * Hosts that are not on the public internet: loopback, RFC 1918, link-local, CGNAT (Tailscale),
 * IPv6 unique-local / link-local, and non-dotted names (Docker service names, host.docker.internal,
 * `*.local`, `*.internal`, `*.lan`).
 */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(host)) return true;
  const v4 = ipv4Octets(host);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(host) === 6) {
    return /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return (
    !host.includes('.') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan')
  );
}

/**
 * Checks EMBEDDING_API_URL: must be http(s); plain http is an error for public hosts (the API key
 * and every document text would cross the internet unencrypted) and a warning for private ones.
 */
export function assessEmbeddingApiUrl(raw: string): UrlAssessment {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      error: `EMBEDDING_API_URL "${raw}" is not a valid URL (expected e.g. ${DEFAULT_EMBEDDING_API_URL})`,
    };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      error: `EMBEDDING_API_URL must use https:// (or http:// for a local/private server), got ${url.protocol}//`,
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      error:
        'EMBEDDING_API_URL must not contain credentials; put the key in EMBEDDING_API_KEY',
    };
  }
  if (url.protocol === 'http:') {
    if (isLoopbackHost(url.hostname)) return { ok: true, url };
    if (isPrivateHost(url.hostname)) {
      return {
        ok: true,
        url,
        warning: `EMBEDDING_API_URL uses plain http:// to a private host (${url.hostname}): the API key and all document text travel unencrypted. Use https:// unless this network is trusted.`,
      };
    }
    return {
      ok: false,
      error: `EMBEDDING_API_URL uses plain http:// to a public host (${url.hostname}), which would send the API key and document text unencrypted. Use https://`,
    };
  }
  return { ok: true, url };
}
