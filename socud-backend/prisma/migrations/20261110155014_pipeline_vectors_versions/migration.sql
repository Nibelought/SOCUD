-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "draftHtml" TEXT,
ADD COLUMN     "draftText" TEXT,
ADD COLUMN     "embeddedVersion" INTEGER,
ADD COLUMN     "publishedVersion" INTEGER NOT NULL DEFAULT 0;

-- Embedding model switch (768-dim -> Qwen3-Embedding, 1024 dims).
-- Old vectors are incompatible and are discarded. Chunk rows are kept (with a NULL embedding) so
-- nothing is lost if the backfill runs late; the backfill (npm run backfill:embeddings, or the
-- startup/periodic reconcile of the API) re-chunks and re-embeds every published document.
DROP INDEX IF EXISTS "DocumentChunk_embedding_hnsw_idx";
ALTER TABLE "DocumentChunk" DROP COLUMN "embedding";
ALTER TABLE "DocumentChunk" ADD COLUMN "embedding" vector(1024);

-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "chunkIndex" INTEGER NOT NULL DEFAULT 0;

-- Recreate the HNSW index (cosine) for the new column. NULL embeddings are not indexed.
CREATE INDEX "DocumentChunk_embedding_hnsw_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "yjsState" BYTEA,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_createdAt_idx" ON "DocumentVersion"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
