import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Same defaults as src/lib/config.ts. NEXT_PUBLIC_* are read at build/start time here.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:3002";

const originOf = (url: string): string => new URL(url).origin;

const connectSrc = [
  "'self'",
  originOf(API_URL),
  originOf(WS_URL),
  // Next dev server HMR websocket.
  ...(isDev ? ["ws:"] : []),
];

// App Router without nonces relies on Next's inline bootstrap/flight scripts, so
// 'unsafe-inline' is required for script-src (this weakens CSP's XSS mitigation
// for scripts; the HTML sanitizers remain the primary defence). 'unsafe-eval' is
// only needed by React/Next dev tooling and is never sent in production.
const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])];

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  // KaTeX, Tailwind and Tiptap emit inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // next/font/google is self-hosted at build time, so no fonts.gstatic.com needed.
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
