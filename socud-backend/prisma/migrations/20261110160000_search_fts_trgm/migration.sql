-- Search: full-text (tsvector) + trigram indexes.
--
-- Text search configuration: the built-in 'russian' one. It maps ASCII words to english_stem and
-- everything else to russian_stem, so mixed Russian/English text is stemmed in both languages
-- (and the Russian stemmer folds e/yo). The configuration is part of the generated expressions
-- below: changing it requires a new migration that recreates the columns, and the query side
-- (src/search/search.constants.ts, FTS_CONFIG) must use the same name.
--
-- unaccent is deliberately not installed: it is not IMMUTABLE (unusable in a generated column
-- without a wrapper) and the Russian stemmer already handles e/yo.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Titles only. Published body text lives in DocumentChunk (below); draftText is NOT indexed:
-- it is rewritten by every autosave (Hocuspocus onStoreDocument), which would re-tokenize and
-- re-index the whole text every couple of seconds, and search deliberately shows only content
-- that was published. Unpublished documents are therefore found by title.
-- (Generated columns are recomputed only when a referenced column is updated.)
ALTER TABLE "Document" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (setweight(to_tsvector('russian'::regconfig, coalesce("title", '')), 'A')) STORED;

-- Weight B (not the default D) so chunk and title ranks are on a comparable scale.
ALTER TABLE "DocumentChunk" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (setweight(to_tsvector('russian'::regconfig, coalesce("textContent", '')), 'B')) STORED;

-- CreateIndex
CREATE INDEX "Document_searchVector_idx" ON "Document" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "DocumentChunk_searchVector_idx" ON "DocumentChunk" USING GIN ("searchVector");

-- CreateIndex: trigram (typos, partial words, ILIKE '%x%') on titles. Not on chunk text: a trigram
-- index over body text is as large as the text itself and full-text + vectors already cover it.
CREATE INDEX "Document_title_trgm_idx" ON "Document" USING GIN ("title" gin_trgm_ops);
