import { extractLinkedDocumentIds } from './links';

const A = '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b';
const B = '4f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7c';

describe('extractLinkedDocumentIds', () => {
  it('finds relative and absolute links, deduplicated, lowercased', () => {
    const html =
      `<a href="/document/${A}">x</a>` +
      `<a href="https://app.example/document/${A.toUpperCase()}">y</a>` +
      `<a href="https://app.example/document/${B}?x=1">z</a>`;
    expect(extractLinkedDocumentIds(html, 'self')).toEqual([A, B]);
  });

  it('ignores self links and UUIDs outside href', () => {
    const html = `<a href="/document/${A}">x</a><p>${B}</p>`;
    expect(extractLinkedDocumentIds(html, A)).toEqual([]);
  });
});
