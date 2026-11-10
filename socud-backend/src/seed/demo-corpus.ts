import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Languages of the demo corpus (directory names under prisma/demo-data). */
export const DEMO_LANGUAGES = ['en', 'ru', 'uk'] as const;
export type DemoLanguage = (typeof DEMO_LANGUAGES)[number];

/** Topics of the demo corpus. A corpus file `programming-2.txt` belongs to the topic `programming`. */
export const DEMO_TOPICS = ['programming', 'math', 'finance'] as const;
export type DemoTopic = (typeof DEMO_TOPICS)[number];

export class DemoSeedError extends Error {}

export interface CorpusDoc {
  /** Unique within its corpus file. */
  slug: string;
  title: string;
  /** Slug of the parent document in the same file. */
  parent?: string;
  /** HTML body, may contain `{{doc:slug}}` link placeholders. */
  html: string;
}

export interface CorpusFile {
  language: DemoLanguage;
  topic: DemoTopic;
  /** File name without extension, e.g. `programming-2`. */
  name: string;
  docs: CorpusDoc[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOC_START = /^=== ([^\s=]+) ===\s*$/;

/**
 * Parses one corpus file (format: see prisma/demo-data/README.md):
 *
 *   === slug ===
 *   title: Title
 *   parent: other-slug      (optional)
 *   ---
 *   <html body>
 */
export function parseCorpusText(text: string, source = 'corpus'): CorpusDoc[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const docs: CorpusDoc[] = [];
  const slugs = new Set<string>();

  let i = 0;
  while (i < lines.length && !DOC_START.test(lines[i])) {
    if (lines[i].trim()) {
      throw new DemoSeedError(
        `${source}:${i + 1}: text before the first "=== slug ===" line`,
      );
    }
    i++;
  }

  while (i < lines.length) {
    const start = DOC_START.exec(lines[i]);
    if (!start) {
      throw new DemoSeedError(`${source}:${i + 1}: expected "=== slug ==="`);
    }
    const slug = start[1];
    if (!SLUG.test(slug)) {
      throw new DemoSeedError(`${source}:${i + 1}: invalid slug "${slug}"`);
    }
    if (slugs.has(slug)) {
      throw new DemoSeedError(`${source}:${i + 1}: duplicate slug "${slug}"`);
    }
    slugs.add(slug);
    i++;

    const headers = new Map<string, string>();
    while (i < lines.length && lines[i].trim() !== '---') {
      if (DOC_START.test(lines[i])) {
        throw new DemoSeedError(`${source}: "${slug}" has no "---" line`);
      }
      const header = /^(title|parent):\s*(.*)$/.exec(lines[i]);
      if (header) headers.set(header[1], header[2].trim());
      else if (lines[i].trim()) {
        throw new DemoSeedError(
          `${source}:${i + 1}: unknown header line "${lines[i]}"`,
        );
      }
      i++;
    }
    if (i >= lines.length) {
      throw new DemoSeedError(`${source}: "${slug}" has no "---" line`);
    }
    i++; // skip ---

    const body: string[] = [];
    while (i < lines.length && !DOC_START.test(lines[i])) body.push(lines[i++]);

    const title = headers.get('title');
    if (!title) throw new DemoSeedError(`${source}: "${slug}" has no title`);
    const html = body.join('\n').trim();
    if (!html) throw new DemoSeedError(`${source}: "${slug}" has no body`);

    const parent = headers.get('parent') || undefined;
    if (parent && !slugs.has(parent)) {
      throw new DemoSeedError(
        `${source}: "${slug}" has parent "${parent}" which is not defined above it`,
      );
    }
    docs.push({ slug, title, parent, html });
  }
  return docs;
}

/** Reads every `<dir>/<lang>/<topic>[-n].txt`, sorted for deterministic output. */
export function loadCorpus(dir: string): CorpusFile[] {
  const files: CorpusFile[] = [];
  for (const language of DEMO_LANGUAGES) {
    let names: string[];
    try {
      names = readdirSync(join(dir, language)).filter((n) =>
        n.endsWith('.txt'),
      );
    } catch {
      continue; // a missing language directory just contributes nothing
    }
    for (const file of names.sort()) {
      const name = file.slice(0, -'.txt'.length);
      const topic = DEMO_TOPICS.find(
        (t) => name === t || name.startsWith(`${t}-`),
      );
      if (!topic) {
        throw new DemoSeedError(
          `${language}/${file}: file name must start with one of ${DEMO_TOPICS.join(', ')}`,
        );
      }
      const source = `${language}/${file}`;
      const docs = parseCorpusText(
        readFileSync(join(dir, language, file), 'utf8'),
        source,
      );
      files.push({ language, topic, name, docs });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

export type EmbedMode = 'none' | 'inline' | 'queue';

export interface DemoOptions {
  languages: DemoLanguage[];
  topics: DemoTopic[];
  /** Maximum number of documents in total (taken round-robin from every corpus file). */
  limit?: number;
  embed: EmbedMode;
  reset: boolean;
  /** Do nothing (exit normally) when demo data already exists. Mutually exclusive with `reset`. */
  ifMissing: boolean;
  password?: string;
  /** Seed of the pseudo random choices (statuses, authors, dates). */
  seed: number;
  corpusDir?: string;
  help: boolean;
}

function parseList<T extends string>(
  flag: string,
  raw: string,
  allowed: readonly T[],
): T[] {
  const values = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0) throw new DemoSeedError(`${flag} needs a value`);
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new DemoSeedError(
        `${flag}: unknown value "${value}" (allowed: ${allowed.join(', ')})`,
      );
    }
  }
  return [...new Set(values)] as T[];
}

/** `--langs en,uk` keeps only those languages, `--exclude ru` drops some; at least one must remain. */
export function selectLanguages(
  langs: DemoLanguage[] | undefined,
  exclude: DemoLanguage[] | undefined,
): DemoLanguage[] {
  const selected = (langs ?? [...DEMO_LANGUAGES]).filter(
    (l) => !exclude?.includes(l),
  );
  if (selected.length === 0) {
    throw new DemoSeedError(
      'No language left: --exclude removes every language',
    );
  }
  return selected;
}

export function parseDemoArgs(argv: string[]): DemoOptions {
  const valued = new Set([
    '--langs',
    '--exclude',
    '--topics',
    '--limit',
    '--password',
    '--seed',
    '--corpus-dir',
  ]);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let embed: EmbedMode = 'none';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    if (name === '--embed') {
      // Bare --embed embeds in this process; --embed=queue hands the work to Redis/BullMQ.
      const mode = inline ?? 'inline';
      if (mode !== 'inline' && mode !== 'queue') {
        throw new DemoSeedError(
          `--embed: unknown mode "${mode}" (inline | queue)`,
        );
      }
      embed = mode;
    } else if (name === '--no-embed') {
      embed = 'none';
    } else if (valued.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new DemoSeedError(`${name} needs a value`);
      }
      values.set(name, value);
    } else if (
      name === '--reset' ||
      name === '--if-missing' ||
      name === '--help' ||
      name === '-h'
    ) {
      flags.add(name === '-h' ? '--help' : name);
    } else {
      throw new DemoSeedError(`Unknown option: ${arg}`);
    }
  }

  if (flags.has('--reset') && flags.has('--if-missing')) {
    throw new DemoSeedError(
      '--reset and --if-missing are mutually exclusive: pick one',
    );
  }

  const exclude = values.has('--exclude')
    ? parseList('--exclude', values.get('--exclude') as string, DEMO_LANGUAGES)
    : undefined;
  const langs = values.has('--langs')
    ? parseList('--langs', values.get('--langs') as string, DEMO_LANGUAGES)
    : undefined;
  const topics = values.has('--topics')
    ? parseList('--topics', values.get('--topics') as string, DEMO_TOPICS)
    : [...DEMO_TOPICS];

  const positiveInt = (flag: string, raw: string | undefined) => {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new DemoSeedError(`${flag} must be a positive integer`);
    }
    return n;
  };

  return {
    languages: selectLanguages(langs, exclude),
    topics,
    limit: positiveInt('--limit', values.get('--limit')),
    embed,
    reset: flags.has('--reset'),
    ifMissing: flags.has('--if-missing'),
    password: values.get('--password'),
    seed: positiveInt('--seed', values.get('--seed')) ?? 20260101,
    corpusDir: values.get('--corpus-dir'),
    help: flags.has('--help'),
  };
}

// ---------------------------------------------------------------------------------------------
// Selection and link resolution
// ---------------------------------------------------------------------------------------------

/**
 * Restricts the corpus to the chosen languages/topics and, with `limit`, to that many documents
 * in total, taking them round-robin from every file so a small sample still mixes languages and
 * topics. A parent that is cut off turns the child into a root document.
 */
export function selectCorpus(
  files: CorpusFile[],
  options: Pick<DemoOptions, 'languages' | 'topics' | 'limit'>,
): CorpusFile[] {
  const chosen = files.filter(
    (f) =>
      options.languages.includes(f.language) &&
      options.topics.includes(f.topic),
  );
  if (options.limit === undefined) return chosen;

  const keep = new Set<string>();
  const key = (file: CorpusFile, slug: string) =>
    `${file.language}/${file.name}/${slug}`;
  const longest = Math.max(0, ...chosen.map((f) => f.docs.length));
  for (let row = 0; row < longest && keep.size < options.limit; row++) {
    for (const file of chosen) {
      if (keep.size >= options.limit) break;
      if (row < file.docs.length) keep.add(key(file, file.docs[row].slug));
    }
  }
  return chosen
    .map((file) => ({
      ...file,
      docs: file.docs
        .filter((d) => keep.has(key(file, d.slug)))
        .map((d) =>
          d.parent && !keep.has(key(file, d.parent))
            ? { ...d, parent: undefined }
            : d,
        ),
    }))
    .filter((file) => file.docs.length > 0);
}

const PLACEHOLDER = /<a\s+href="\{\{doc:([a-z0-9-]+)\}\}"\s*>([\s\S]*?)<\/a>/g;

/**
 * Replaces `<a href="{{doc:slug}}">text</a>` with a link to the document's page. Links to unknown
 * slugs (e.g. cut off by --limit) keep their text and lose the anchor.
 */
export function resolveDocLinks(
  html: string,
  idBySlug: ReadonlyMap<string, string>,
): { html: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = html.replace(
    PLACEHOLDER,
    (_m, slug: string, text: string) => {
      const id = idBySlug.get(slug);
      if (!id) {
        unresolved.push(slug);
        return text;
      }
      return `<a href="/document/${id}/view">${text}</a>`;
    },
  );
  // Placeholders in any other shape would end up as a broken href: drop them the same way.
  const leftover = resolved.replace(
    /<a\s+[^>]*href="\{\{doc:[^"]*\}\}"[^>]*>([\s\S]*?)<\/a>/g,
    (_m, text: string) => text,
  );
  return { html: leftover, unresolved };
}

/** Small deterministic PRNG (mulberry32) so the same --seed always yields the same data. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
