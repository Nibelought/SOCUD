// Backend endpoints. NEXT_PUBLIC_* values are inlined into the bundle at build
// time, so the property accesses below must stay as literal `process.env.NEXT_PUBLIC_*`.
const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

export const API_URL = stripTrailingSlash(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
);

export const WS_URL = stripTrailingSlash(
  process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:3002',
);
