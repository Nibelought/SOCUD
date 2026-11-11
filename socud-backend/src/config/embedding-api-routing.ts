/** Why EMBEDDING_API_PROVIDER_ROUTING is not usable, or the parsed object. */
export type RoutingParse =
  | { ok: true; routing: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * EMBEDDING_API_PROVIDER_ROUTING: a JSON object that is sent verbatim as the `provider` field of
 * the embeddings request (OpenRouter provider routing, e.g. `{"sort":"latency"}` or
 * `{"ignore":["DeepInfra"]}`). Anything that is not a JSON object is rejected.
 */
export function parseProviderRouting(raw: string): RoutingParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `is not valid JSON (${err instanceof Error ? err.message : String(err)}); expected an object such as {"sort":"latency"}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `must be a JSON object such as {"sort":"latency"}, not ${
        Array.isArray(parsed)
          ? 'an array'
          : parsed === null
            ? 'null'
            : typeof parsed
      }`,
    };
  }
  return { ok: true, routing: parsed as Record<string, unknown> };
}
