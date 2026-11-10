import {
  CorpusFile,
  createRng,
  DemoSeedError,
  parseCorpusText,
  parseDemoArgs,
  resolveDocLinks,
  selectCorpus,
  selectLanguages,
} from './demo-corpus';

const SAMPLE = `=== intro ===
title: Intro
---
<p>Hello</p>

=== deep-dive ===
title: Deep dive: details
parent: intro
---
<h2>Part</h2>
<p>See <a href="{{doc:intro}}">intro</a>.</p>
`;

describe('parseCorpusText', () => {
  it('parses documents, headers and bodies', () => {
    const docs = parseCorpusText(SAMPLE);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      slug: 'intro',
      title: 'Intro',
      parent: undefined,
      html: '<p>Hello</p>',
    });
    expect(docs[1].title).toBe('Deep dive: details');
    expect(docs[1].parent).toBe('intro');
    expect(docs[1].html).toContain('{{doc:intro}}');
  });

  it('rejects duplicate slugs, missing titles, bad parents and stray text', () => {
    expect(() =>
      parseCorpusText(
        '=== a ===\ntitle: A\n---\nx\n=== a ===\ntitle: B\n---\ny',
      ),
    ).toThrow(DemoSeedError);
    expect(() => parseCorpusText('=== a ===\n---\nx')).toThrow(/no title/);
    expect(() =>
      parseCorpusText('=== a ===\ntitle: A\nparent: b\n---\nx'),
    ).toThrow(/parent/);
    expect(() => parseCorpusText('oops\n=== a ===\ntitle: A\n---\nx')).toThrow(
      /before the first/,
    );
    expect(() => parseCorpusText('=== A_b ===\ntitle: A\n---\nx')).toThrow(
      /invalid slug/,
    );
    expect(() => parseCorpusText('=== a ===\ntitle: A\n---\n')).toThrow(
      /no body/,
    );
  });
});

describe('language selection', () => {
  it('defaults to every language and applies --exclude / --langs', () => {
    expect(selectLanguages(undefined, undefined)).toEqual(['en', 'ru', 'uk']);
    expect(selectLanguages(undefined, ['ru'])).toEqual(['en', 'uk']);
    expect(selectLanguages(['en', 'uk'], undefined)).toEqual(['en', 'uk']);
    expect(selectLanguages(['en', 'ru'], ['ru'])).toEqual(['en']);
  });

  it('refuses to exclude everything', () => {
    expect(() => selectLanguages(undefined, ['en', 'ru', 'uk'])).toThrow(
      /No language left/,
    );
  });
});

describe('parseDemoArgs', () => {
  it('has safe defaults', () => {
    const o = parseDemoArgs([]);
    expect(o).toMatchObject({
      languages: ['en', 'ru', 'uk'],
      embed: 'none',
      reset: false,
      help: false,
    });
    expect(o.topics).toEqual(['programming', 'math', 'finance']);
  });

  it('parses --if-missing and refuses to combine it with --reset', () => {
    expect(parseDemoArgs([]).ifMissing).toBe(false);
    expect(parseDemoArgs(['--if-missing']).ifMissing).toBe(true);
    expect(parseDemoArgs(['--if-missing']).reset).toBe(false);
    expect(() => parseDemoArgs(['--if-missing', '--reset'])).toThrow(
      DemoSeedError,
    );
    expect(() => parseDemoArgs(['--reset', '--if-missing'])).toThrow(
      /mutually exclusive/,
    );
  });

  it('parses --exclude in both spellings, case-insensitively', () => {
    expect(parseDemoArgs(['--exclude', 'RU']).languages).toEqual(['en', 'uk']);
    expect(parseDemoArgs(['--exclude=ru,uk']).languages).toEqual(['en']);
  });

  it('parses embed modes', () => {
    expect(parseDemoArgs(['--embed']).embed).toBe('inline');
    expect(parseDemoArgs(['--embed=queue']).embed).toBe('queue');
    expect(parseDemoArgs(['--embed', '--no-embed']).embed).toBe('none');
    expect(() => parseDemoArgs(['--embed=gpu'])).toThrow(/unknown mode/);
  });

  it('validates values', () => {
    expect(() => parseDemoArgs(['--exclude', 'de'])).toThrow(
      /unknown value "de"/,
    );
    expect(() => parseDemoArgs(['--exclude'])).toThrow(/needs a value/);
    expect(() => parseDemoArgs(['--limit', '0'])).toThrow(/positive integer/);
    expect(() => parseDemoArgs(['--exclude', 'en,ru,uk'])).toThrow(
      /No language left/,
    );
    expect(() => parseDemoArgs(['--bogus'])).toThrow(/Unknown option/);
    expect(
      parseDemoArgs(['--limit', '5', '--reset', '--topics', 'math']).limit,
    ).toBe(5);
  });
});

describe('resolveDocLinks', () => {
  const ids = new Map([['a', 'id-a']]);

  it('turns placeholders into document links and drops unknown ones', () => {
    const out = resolveDocLinks(
      '<p><a href="{{doc:a}}">A</a> and <a href="{{doc:zzz}}">gone</a></p>',
      ids,
    );
    expect(out.html).toBe(
      '<p><a href="/document/id-a/view">A</a> and gone</p>',
    );
    expect(out.unresolved).toEqual(['zzz']);
  });

  it('never leaves a placeholder behind', () => {
    const out = resolveDocLinks('<a class="x" href="{{doc:A B}}">odd</a>', ids);
    expect(out.html).toBe('odd');
  });
});

describe('selectCorpus', () => {
  const doc = (slug: string, parent?: string) => ({
    slug,
    title: slug,
    parent,
    html: '<p>x</p>',
  });
  const files: CorpusFile[] = [
    {
      language: 'en',
      topic: 'math',
      name: 'math',
      docs: [doc('a'), doc('b', 'a'), doc('c')],
    },
    { language: 'ru', topic: 'math', name: 'math', docs: [doc('d'), doc('e')] },
    { language: 'uk', topic: 'finance', name: 'finance', docs: [doc('f')] },
  ];

  it('filters by language and topic', () => {
    const out = selectCorpus(files, {
      languages: ['en', 'uk'],
      topics: ['math'],
      limit: undefined,
    });
    expect(out.map((f) => f.language)).toEqual(['en']);
  });

  it('limits round-robin across files and detaches orphans', () => {
    const out = selectCorpus(files, {
      languages: ['en', 'ru', 'uk'],
      topics: ['math', 'finance'],
      limit: 4,
    });
    expect(out.flatMap((f) => f.docs.map((d) => d.slug))).toEqual([
      'a',
      'b',
      'd',
      'f',
    ]);
    const orphan = selectCorpus(files, {
      languages: ['en'],
      topics: ['math'],
      limit: 3,
    });
    expect(orphan[0].docs.find((d) => d.slug === 'b')?.parent).toBe('a');
    const cut = selectCorpus(
      [{ ...files[0], docs: [doc('a'), doc('c'), doc('b', 'a')] }],
      { languages: ['en'], topics: ['math'], limit: 2 },
    );
    expect(cut[0].docs.map((d) => d.slug)).toEqual(['a', 'c']);
  });
});

describe('createRng', () => {
  it('is deterministic and within [0, 1)', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
