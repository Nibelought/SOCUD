/**
 * Embedding profiles: one switch (`EMBEDDING_PROFILE=<name>`) selects a complete set of embedding
 * settings, so changing the vectorization method (local worker, worker on a PC, hosted API) means
 * changing one variable.
 *
 * Every variable named `<NAME>__<VAR>` (profile name upper-cased, `-` -> `_`, double underscore)
 * belongs to the profile `<name>`. For the ACTIVE profile it sets `<VAR>`, replacing a plain
 * `<VAR>` (also an empty one, which is what docker compose passes for unset variables). The
 * variables of every other profile are ignored. Only the settings in `isProfileScopedVar` can be
 * scoped to a profile; anything else is a startup error, so a typo cannot silently do nothing.
 *
 * This is the ONE place that resolves it. Every entry point goes through `validateEnv`, which calls
 * `applyEmbeddingProfile` first; `dev.sh` implements the same rules for the shell (see dev.sh and
 * its test).
 */

/** Name of the switch variable. Not itself profile-scoped. */
export const EMBEDDING_PROFILE_VAR = 'EMBEDDING_PROFILE';

/** A profile name: lower-case letters, digits, `_` and `-`; starts with a letter or digit. */
const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
/** `<NAME>__<VAR>`: NAME starts with a letter/digit (so `__CF_USER_TEXT_ENCODING` is not one). */
const PROFILE_VAR = /^([A-Z0-9][A-Z0-9_]*?)__([A-Z0-9_]+)$/;

/** Settings that can be scoped to a profile: embedding and semantic-search settings only. */
export function isProfileScopedVar(name: string): boolean {
  if (name === EMBEDDING_PROFILE_VAR) return false;
  return (
    name.startsWith('EMBEDDING_') ||
    name.startsWith('EMBED_') ||
    name === 'AI_WORKER_URL' ||
    name === 'AI_WORKER_TOKEN' ||
    name === 'SEARCH_MIN_SIMILARITY'
  );
}

/** `API` for `api`, `MY_PC` for `my-pc`. */
export function profileEnvPrefix(profile: string): string {
  return profile.toUpperCase().replace(/-/g, '_');
}

export interface EmbeddingProfileResult {
  /** The environment to validate: the input with the active profile's variables applied. */
  env: Record<string, unknown>;
  /** Normalised active profile name, or null when none is selected. */
  profile: string | null;
  /** The variables the profile set (names only, never values). */
  applied: string[];
}

/** Upper-case prefixes (`API`, `PC`...) that have at least one `<PREFIX>__<VAR>` variable. */
function foundPrefixes(env: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const key of Object.keys(env)) {
    const match = PROFILE_VAR.exec(key);
    if (match) found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Applies the active profile to `env`. Pure: returns a new object and never reads `process.env`.
 * Without a (non-empty) EMBEDDING_PROFILE the input is returned unchanged. Throws an Error whose
 * message is meant to be shown to the user when the name is malformed, names a profile that has no
 * variables, or the profile scopes a variable that is not an embedding/search setting.
 */
export function applyEmbeddingProfile(
  env: Record<string, unknown>,
): EmbeddingProfileResult {
  const raw = env[EMBEDDING_PROFILE_VAR];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '') return { env, profile: null, applied: [] };

  const profile = trimmed.toLowerCase();
  if (!PROFILE_NAME.test(profile)) {
    throw new Error(
      `EMBEDDING_PROFILE="${trimmed}" is not a valid profile name: use lower-case letters, digits, "_" and "-" (e.g. local, pc, api).`,
    );
  }

  const prefix = `${profileEnvPrefix(profile)}__`;
  const scoped = Object.keys(env).filter((key) => key.startsWith(prefix));
  const found = foundPrefixes(env);
  if (scoped.length === 0) {
    const known =
      found.length === 0
        ? 'no profile variables (<NAME>__EMBEDDING_PROVIDER=...) are set at all'
        : `profiles with variables: ${found.map((p) => p.toLowerCase().replace(/_/g, '-')).join(', ')}`;
    throw new Error(
      `EMBEDDING_PROFILE="${profile}" has no ${prefix}* variables (${known}). ` +
        `Define the profile in .env (${prefix}EMBEDDING_PROVIDER=...) or unset EMBEDDING_PROFILE. ` +
        'Names are matched case-insensitively; "-" in a profile name is written "_" in its variables.',
    );
  }

  const resolved: Record<string, unknown> = { ...env };
  const applied: string[] = [];
  const rejected: string[] = [];
  for (const key of scoped.sort()) {
    const name = key.slice(prefix.length);
    if (!PROFILE_VAR.test(key) || !isProfileScopedVar(name)) {
      rejected.push(key);
      continue;
    }
    resolved[name] = env[key];
    applied.push(name);
  }
  if (rejected.length > 0) {
    throw new Error(
      `EMBEDDING_PROFILE="${profile}": ${rejected.join(', ')} cannot be profile-scoped. ` +
        'A profile may set only EMBEDDING_* (not EMBEDDING_PROFILE), EMBED_*, AI_WORKER_URL, AI_WORKER_TOKEN and SEARCH_MIN_SIMILARITY.',
    );
  }
  resolved[EMBEDDING_PROFILE_VAR] = profile;
  return { env: resolved, profile, applied };
}
