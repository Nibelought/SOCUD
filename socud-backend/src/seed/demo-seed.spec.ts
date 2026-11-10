import { CorpusFile } from './demo-corpus';
import {
  buildDemoPlan,
  htmlToProseMirror,
  DEMO_EMAIL_DOMAIN,
  DEMO_SPACE_PREFIX,
} from './demo-seed';

const body = (n: number) =>
  `<h2>Part ${n}</h2><p>${'Привіт, світе. '.repeat(180)}</p>`;

const files: CorpusFile[] = [
  {
    language: 'uk',
    topic: 'programming',
    name: 'programming-1',
    docs: [
      {
        slug: 'root',
        title: 'Корінь',
        html: `<p>Старт <a href="{{doc:child}}">далі</a></p>${body(1)}${body(2)}<p>кінець</p>`,
      },
      {
        slug: 'child',
        title: 'Дитина',
        parent: 'root',
        html: `<p>Формула <span data-type="inlineMath" data-latex="x^2" data-display="no"></span></p><pre><code class="language-python">print(1)\n</code></pre><p><a href="{{doc:missing}}">x</a></p>`,
      },
    ],
  },
  {
    language: 'en',
    topic: 'finance',
    name: 'finance',
    docs: Array.from({ length: 10 }, (_, i) => ({
      slug: `d${i}`,
      title: `Doc ${i}`,
      html: `<p>Some text ${i}</p><p>More</p><p>Last</p>`,
    })),
  },
];

describe('htmlToProseMirror', () => {
  it('keeps the language of code blocks', () => {
    const json = htmlToProseMirror(
      '<pre><code class="language-sql">select 1</code></pre><pre><code>plain</code></pre><pre><code class="language-ts">1</code></pre>',
    );
    const langs = (json.content ?? []).map((n) => n.attrs?.language);
    expect(langs).toEqual(['sql', null, 'ts']);
  });
});

describe('buildDemoPlan', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const plan = buildDemoPlan(files, { seed: 1 }, now);

  it('tags users and spaces so that --reset can find them', () => {
    expect(
      plan.users.every((u) => u.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)),
    ).toBe(true);
    expect(plan.spaces.every((s) => s.name.startsWith(DEMO_SPACE_PREFIX))).toBe(
      true,
    );
    expect(plan.spaces).toHaveLength(2); // only the topics that have documents
  });

  it('creates a consistent tree with Yjs state for every document', () => {
    const root = plan.documents.find((d) => d.title === 'Корінь');
    const child = plan.documents.find((d) => d.title === 'Дитина');
    expect(child?.parentId).toBe(root?.id);
    expect(plan.documents).toHaveLength(12);
    for (const d of plan.documents) {
      expect((d.yjsState as Buffer).length).toBeGreaterThan(0);
      expect(d.draftHtml).toBeTruthy();
      expect((d.updatedAt as Date) >= (d.createdAt as Date)).toBe(true);
    }
    // parents are never drafts or archived
    expect(root?.contentHtml).toBeTruthy();
    expect(root?.isArchived).toBe(false);
  });

  it('mirrors Publish: version rows, chunks without vectors, resolved links', () => {
    const root = plan.documents.find((d) => d.title === 'Корінь');
    const child = plan.documents.find((d) => d.title === 'Дитина');
    expect(root?.publishedVersion).toBeGreaterThanOrEqual(1);
    expect(root?.embeddedVersion).toBeNull();
    expect(
      plan.versions
        .filter((v) => v.documentId === root?.id)
        .map((v) => v.version)
        .pop(),
    ).toBe(root?.publishedVersion);
    expect(
      plan.chunks.filter((c) => c.documentId === root?.id).length,
    ).toBeGreaterThan(1);
    expect(plan.links).toContainEqual({
      sourceDocId: root?.id,
      targetDocId: child?.id,
    });
    expect(root?.contentHtml).toContain(`/document/${child?.id}/view`);
    expect(plan.warnings.join()).toContain('unknown "missing"');
    expect(child?.draftHtml).toContain('language-python');
    expect(child?.draftHtml).toContain('$x^2$');
    // drafts have no published content, no version and no chunks
    for (const d of plan.documents.filter((x) => x.contentHtml === null)) {
      expect(d.publishedVersion).toBe(0);
      expect(plan.versions.some((v) => v.documentId === d.id)).toBe(false);
      expect(plan.chunks.some((c) => c.documentId === d.id)).toBe(false);
    }
    expect(
      plan.embeddable.every((e) =>
        plan.chunks.some((c) => c.documentId === e.id),
      ),
    ).toBe(true);
  });

  it('is deterministic for a given seed (apart from ids)', () => {
    const again = buildDemoPlan(files, { seed: 1 }, now);
    const shape = (p: typeof plan) =>
      p.documents.map((d) => [
        d.title,
        d.publishedVersion,
        d.isArchived,
        d.createdAt,
      ]);
    expect(shape(again)).toEqual(shape(plan));
  });

  it('never gives a user two document-level roles on the same document', () => {
    const keys = plan.documentMembers.map((m) => `${m.userId}:${m.documentId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
