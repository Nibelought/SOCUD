import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PRISMA_DIR = join(__dirname, '..', '..', 'prisma');

/**
 * Prisma 7 cannot declare the HNSW index, so the schema keeps a plain `@@index([embedding])`
 * while the migrations create the real one. These checks stop the two from being "fixed" into
 * a state where `migrate dev` would drop or rebuild the index (see the comment in schema.prisma).
 */
describe('DocumentChunk HNSW index', () => {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');

  it('is declared in the schema without type or ops (Prisma would turn it into a btree)', () => {
    expect(schema).toMatch(
      /^\s*@@index\(\[embedding\], map: "DocumentChunk_embedding_hnsw_idx"\)\s*$/m,
    );
    expect(schema).not.toMatch(/embedding\(ops:/);
  });

  it('is created as an HNSW cosine index by the latest migration that touches it', () => {
    const migrations = readdirSync(join(PRISMA_DIR, 'migrations'))
      .filter((name) => /^\d+_/.test(name))
      .sort()
      .map((name) =>
        readFileSync(
          join(PRISMA_DIR, 'migrations', name, 'migration.sql'),
          'utf8',
        ),
      )
      .filter((sql) => sql.includes('DocumentChunk_embedding_hnsw_idx'));
    const latest = migrations[migrations.length - 1];
    expect(latest).toMatch(
      /CREATE INDEX "DocumentChunk_embedding_hnsw_idx" ON "DocumentChunk" USING hnsw \("embedding" vector_cosine_ops\)/,
    );
  });
});
