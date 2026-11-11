-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "embeddingModel" TEXT;

-- CreateIndex
CREATE INDEX "DocumentChunk_embeddingModel_idx" ON "DocumentChunk"("embeddingModel");

-- Backfill: every vector stored before this migration came from the local Qwen3-Embedding-4B worker
-- (1024 dims, the only model the system supported until now). Rows without a vector stay NULL.
UPDATE "DocumentChunk" SET "embeddingModel" = 'qwen3-embedding-4b@1024' WHERE "embedding" IS NOT NULL;
