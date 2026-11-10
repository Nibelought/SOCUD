import { randomUUID } from 'node:crypto';
import { getSchema } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { Prisma, Role } from '@prisma/client';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';
import { chunkHtml } from '../pipeline/chunker';
import { extractLinkedDocumentIds } from '../pipeline/links';
import {
  renderYjsState,
  SERVER_EXTENSIONS,
  YJS_FRAGMENT_NAME,
} from '../pipeline/yjs-render';
import {
  CorpusFile,
  createRng,
  DemoTopic,
  resolveDocLinks,
} from './demo-corpus';

/** Everything the demo seed creates is tagged with these, so `--reset` can find (only) it again. */
export const DEMO_EMAIL_DOMAIN = 'demo.socud.local';
export const DEMO_SPACE_PREFIX = '[Demo] ';

export const DEFAULT_DEMO_PASSWORD = 'DemoPass-2026!';

interface SpaceSpec {
  name: string;
  description: string;
  members: Record<string, Role>;
}

/** Demo users: the key becomes the e-mail local part (`anna@demo.socud.local`). */
export const DEMO_USER_KEYS = [
  'anna',
  'ivan',
  'maria',
  'oleg',
  'kate',
] as const;

const SPACE_SPECS: Record<DemoTopic, SpaceSpec> = {
  programming: {
    name: `${DEMO_SPACE_PREFIX}Programming`,
    description: 'Languages, tooling and engineering practice (demo data)',
    members: {
      anna: Role.OWNER,
      ivan: Role.EDITOR,
      maria: Role.EDITOR,
      oleg: Role.VIEWER,
    },
  },
  math: {
    name: `${DEMO_SPACE_PREFIX}Mathematics`,
    description: 'Algebra, calculus, probability and discrete math (demo data)',
    members: { ivan: Role.OWNER, anna: Role.EDITOR, oleg: Role.VIEWER },
  },
  finance: {
    name: `${DEMO_SPACE_PREFIX}Finance`,
    description: 'Personal finance, investing and valuation (demo data)',
    members: {
      ivan: Role.OWNER,
      maria: Role.EDITOR,
      anna: Role.VIEWER,
      oleg: Role.VIEWER,
    },
  },
};

export interface DemoStats {
  documents: number;
  published: number;
  drafts: number;
  archived: number;
  withHistory: number;
  chunks: number;
  links: number;
  characters: number;
  byLanguage: Record<string, number>;
  byTopic: Record<string, number>;
}

export interface DemoPlan {
  users: { id: string; email: string; key: string }[];
  spaces: Prisma.SpaceCreateManyInput[];
  spaceMembers: Prisma.SpaceMemberCreateManyInput[];
  documents: Prisma.DocumentCreateManyInput[];
  documentMembers: Prisma.DocumentMemberCreateManyInput[];
  versions: Prisma.DocumentVersionCreateManyInput[];
  chunks: Prisma.DocumentChunkCreateManyInput[];
  links: Prisma.DocumentLinkCreateManyInput[];
  /** Published documents that have chunks to embed: `{ id, version }`. */
  embeddable: { id: string; version: number; chunks: number }[];
  warnings: string[];
  stats: DemoStats;
}

type PmNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
};

/**
 * HTML -> ProseMirror JSON in the server's schema. `generateJSON` loses the language of code blocks
 * (it looks at a DOM property zeed-dom does not provide), so it is restored from the markup.
 */
export function htmlToProseMirror(html: string): PmNode {
  const languages = [
    ...html.matchAll(/<pre[^>]*>\s*<code(?:\s+class="language-([\w+#.-]+)")?/g),
  ].map((m) => m[1] ?? null);
  const json = generateJSON(html, SERVER_EXTENSIONS) as PmNode;
  let next = 0;
  const walk = (node: PmNode) => {
    if (node.type === 'codeBlock') {
      node.attrs = { ...node.attrs, language: languages[next++] ?? null };
    }
    node.content?.forEach(walk);
  };
  walk(json);
  return json;
}

/** Yjs update (as the editor's collaboration layer would persist it) for a ProseMirror document. */
export function proseMirrorToYjsState(json: PmNode): Uint8Array {
  const ydoc = new Y.Doc();
  try {
    prosemirrorJSONToYXmlFragment(
      getSchema(SERVER_EXTENSIONS),
      json,
      ydoc.getXmlFragment(YJS_FRAGMENT_NAME),
    );
    return Y.encodeStateAsUpdate(ydoc);
  } finally {
    ydoc.destroy();
  }
}

const DAY_MS = 86_400_000;

interface Prepared {
  file: CorpusFile;
  slug: string;
  id: string;
  parentId: string | null;
  title: string;
  html: string; // placeholders resolved
  isParent: boolean;
}

/** Builds every row of the demo data in memory (no database access). */
export function buildDemoPlan(
  files: CorpusFile[],
  options: { seed: number },
  now: Date = new Date(),
): DemoPlan {
  const rng = createRng(options.seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rng() * items.length)];
  const warnings: string[] = [];

  // 1. Ids first, so documents can link to each other.
  const prepared: Prepared[] = [];
  const idByFile = new Map<CorpusFile, Map<string, string>>();
  for (const file of files) {
    const ids = new Map<string, string>();
    for (const doc of file.docs) ids.set(doc.slug, randomUUID());
    idByFile.set(file, ids);
  }
  for (const file of files) {
    const ids = idByFile.get(file) as Map<string, string>;
    const parents = new Set(file.docs.map((d) => d.parent).filter(Boolean));
    for (const doc of file.docs) {
      const { html, unresolved } = resolveDocLinks(doc.html, ids);
      for (const slug of unresolved) {
        warnings.push(
          `${file.language}/${file.name}/${doc.slug}: link to unknown "${slug}" removed`,
        );
      }
      prepared.push({
        file,
        slug: doc.slug,
        id: ids.get(doc.slug) as string,
        parentId: doc.parent ? (ids.get(doc.parent) ?? null) : null,
        title: doc.title,
        html,
        isParent: parents.has(doc.slug),
      });
    }
  }
  const knownIds = new Set(prepared.map((p) => p.id));

  // 2. Users and spaces (only spaces that actually receive documents).
  const users = DEMO_USER_KEYS.map((key) => ({
    id: randomUUID(),
    key,
    email: `${key}@${DEMO_EMAIL_DOMAIN}`,
  }));
  const userId = (key: string) =>
    (users.find((u) => u.key === key) as { id: string }).id;

  const topics = [...new Set(files.map((f) => f.topic))];
  const spaceIds = new Map<DemoTopic, string>();
  const spaces: Prisma.SpaceCreateManyInput[] = [];
  const spaceMembers: Prisma.SpaceMemberCreateManyInput[] = [];
  for (const topic of topics) {
    const spec = SPACE_SPECS[topic];
    const id = randomUUID();
    spaceIds.set(topic, id);
    spaces.push({ id, name: spec.name, description: spec.description });
    for (const [key, role] of Object.entries(spec.members)) {
      spaceMembers.push({ userId: userId(key), spaceId: id, role });
    }
  }

  // 3. Documents.
  const documents: Prisma.DocumentCreateManyInput[] = [];
  const versions: Prisma.DocumentVersionCreateManyInput[] = [];
  const chunks: Prisma.DocumentChunkCreateManyInput[] = [];
  const links: Prisma.DocumentLinkCreateManyInput[] = [];
  const embeddable: DemoPlan['embeddable'] = [];
  const stats: DemoStats = {
    documents: 0,
    published: 0,
    drafts: 0,
    archived: 0,
    withHistory: 0,
    chunks: 0,
    links: 0,
    characters: 0,
    byLanguage: {},
    byTopic: {},
  };

  for (const item of prepared) {
    const spec = SPACE_SPECS[item.file.topic];
    const writers = Object.entries(spec.members)
      .filter(([, role]) => role !== Role.VIEWER)
      .map(([key]) => key);
    const author = userId(pick(writers));
    const updater = userId(pick(writers));

    // Documents that have children stay published and active, so the tree is never cut in half.
    const draft = !item.isParent && rng() < 0.1;
    const archived = !draft && !item.isParent && rng() < 0.04;
    const wantsHistory = !draft && rng() < 0.25;

    const json = htmlToProseMirror(item.html);
    const state = proseMirrorToYjsState(json);
    const rendered = renderYjsState(state);

    const createdAt = new Date(now.getTime() - (5 + rng() * 145) * DAY_MS);
    const updatedAt = new Date(
      createdAt.getTime() + rng() * (now.getTime() - createdAt.getTime()),
    );

    const history = wantsHistory && (json.content?.length ?? 0) >= 3;
    const version = draft ? 0 : history ? 2 : 1;

    if (!draft) {
      if (history) {
        // Version 1 is the same document before its last block was added.
        const earlierState = proseMirrorToYjsState({
          ...json,
          content: json.content?.slice(0, -1),
        });
        const earlier = renderYjsState(earlierState);
        versions.push({
          documentId: item.id,
          version: 1,
          title: item.title,
          contentHtml: earlier.html,
          yjsState: Buffer.from(earlierState),
          createdBy: author,
          createdAt: new Date(createdAt.getTime() + 3_600_000),
        });
      }
      versions.push({
        documentId: item.id,
        version,
        title: item.title,
        contentHtml: rendered.html,
        yjsState: Buffer.from(state),
        createdBy: updater,
        createdAt: updatedAt,
      });

      // Same as Publish: chunks without embedding, links to documents that exist.
      const documentChunks = chunkHtml(rendered.html);
      documentChunks.forEach((textContent, chunkIndex) =>
        chunks.push({ documentId: item.id, chunkIndex, textContent }),
      );
      for (const target of extractLinkedDocumentIds(rendered.html, item.id)) {
        if (knownIds.has(target)) {
          links.push({ sourceDocId: item.id, targetDocId: target });
        }
      }
      if (documentChunks.length > 0) {
        embeddable.push({
          id: item.id,
          version,
          chunks: documentChunks.length,
        });
      }
      stats.chunks += documentChunks.length;
    }

    documents.push({
      id: item.id,
      spaceId: spaceIds.get(item.file.topic) as string,
      parentId: item.parentId,
      title: item.title,
      contentHtml: draft ? null : rendered.html,
      yjsState: Buffer.from(state),
      draftHtml: rendered.html,
      draftText: rendered.text,
      publishedVersion: version,
      embeddedVersion: null,
      createdBy: author,
      updatedBy: updater,
      createdAt,
      updatedAt,
      isArchived: archived,
      archivedAt: archived
        ? new Date(
            updatedAt.getTime() + rng() * (now.getTime() - updatedAt.getTime()),
          )
        : null,
    });

    stats.documents++;
    stats.characters += rendered.text.length;
    if (draft) stats.drafts++;
    else stats.published++;
    if (archived) stats.archived++;
    if (history) stats.withHistory++;
    stats.byLanguage[item.file.language] =
      (stats.byLanguage[item.file.language] ?? 0) + 1;
    stats.byTopic[item.file.topic] = (stats.byTopic[item.file.topic] ?? 0) + 1;
  }
  stats.links = links.length;

  // 4. Document-level sharing on top of space roles: an outsider and a space viewer.
  const documentMembers: Prisma.DocumentMemberCreateManyInput[] = [];
  const shareable = documents.filter((d) => d.contentHtml && !d.isArchived);
  const used = new Set<string>();
  const share = (key: string, role: Role, count: number) => {
    for (let n = 0; n < count && used.size < shareable.length; n++) {
      let doc = pick(shareable);
      while (used.has(doc.id as string)) doc = pick(shareable);
      used.add(doc.id as string);
      documentMembers.push({
        userId: userId(key),
        documentId: doc.id as string,
        role,
      });
    }
  };
  share('kate', Role.VIEWER, 3);
  share('kate', Role.EDITOR, 1);
  share('oleg', Role.EDITOR, 1);

  return {
    users,
    spaces,
    spaceMembers,
    documents,
    documentMembers,
    versions,
    chunks,
    links,
    embeddable,
    warnings,
    stats,
  };
}
