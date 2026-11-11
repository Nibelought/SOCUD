/**
 * Fills the database with demo data: users, spaces, a document tree in English, Russian and
 * Ukrainian (programming, mathematics, finance), drafts, archived documents and version history.
 * The texts live in prisma/demo-data (committed, written offline), so no network is needed.
 *
 *   npm run seed:demo                               # everything, no vectors
 *   npm run seed:demo -- --exclude ru               # leave one language out (or --langs en,uk)
 *   npm run seed:demo -- --topics programming,math  # only some topics
 *   npm run seed:demo -- --limit 12                 # small sample, mixed across languages/topics
 *   npm run seed:demo -- --embed                    # also vectorize (needs the AI worker, or EMBEDDING_PROVIDER=api)
 *   npm run seed:demo -- --embed=queue              # enqueue the embedding jobs for a running API
 *   npm run seed:demo -- --reset                    # delete earlier demo data first
 *   npm run seed:demo -- --if-missing               # do nothing (exit 0) when demo data exists
 *
 * Without --embed the documents have no vectors; keyword/title search works, semantic search does
 * not. NOTE: a running API embeds any published document without vectors about 10 s after it
 * starts (EmbeddingBackfillService); set EMBED_RECONCILE_INTERVAL_MS=0 to keep them unembedded.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PASSWORD_MAX_BYTES } from '../auth/dto/register.dto';
import { hashPassword } from '../auth/password';
import { applyEmbeddingProfile } from '../config/embedding-profile';
import { validateEnv } from '../config/env.validation';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbedDocumentHandler } from '../queue/embed-document.handler';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';
import {
  DemoSeedError,
  loadCorpus,
  parseDemoArgs,
  selectCorpus,
  type DemoOptions,
} from '../seed/demo-corpus';
import {
  buildDemoPlan,
  DEFAULT_DEMO_PASSWORD,
  DEMO_EMAIL_DOMAIN,
  DEMO_SPACE_PREFIX,
  type DemoPlan,
} from '../seed/demo-seed';

const HELP = `Usage: npm run seed:demo -- [options]

  --exclude <langs>   drop languages, e.g. --exclude ru   (en, ru, uk; comma separated)
  --langs <langs>     use only these languages, e.g. --langs en,uk
  --topics <topics>   programming, math, finance (default: all)
  --limit <n>         at most n documents in total, mixed across languages and topics
  --embed[=inline|queue]  vectorize published documents (default mode: inline, needs the AI worker
                      or EMBEDDING_PROVIDER=api;
                      queue: enqueue jobs for a running API/worker). Default: no vectors
  --reset             delete earlier demo data (tagged @${DEMO_EMAIL_DOMAIN} / "${DEMO_SPACE_PREFIX}" spaces) first
  --if-missing        add nothing when demo data already exists (exit 0); mutually exclusive with --reset
  --password <pw>     password of the demo users (or SEED_DEMO_PASSWORD; default ${DEFAULT_DEMO_PASSWORD})
  --seed <n>          seed of the pseudo random choices (statuses, authors, dates)
  --corpus-dir <dir>  alternative corpus directory (default: prisma/demo-data)
`;

/** ~seconds per chunk measured for the MLX worker on an M1 (see .env.example); an estimate only. */
const SECONDS_PER_CHUNK = 2.5;

function loadDotEnv(): void {
  const file = resolve(process.cwd(), '.env');
  if (existsSync(file)) process.loadEnvFile(file); // does not override variables already set
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

async function checkWorker(): Promise<void> {
  // The same resolution the app's ConfigModule does: the active EMBEDDING_PROFILE wins.
  let env: Record<string, unknown>;
  let profile: string | null;
  try {
    ({ env, profile } = applyEmbeddingProfile(process.env));
  } catch (err) {
    throw new DemoSeedError(err instanceof Error ? err.message : String(err));
  }
  const via = profile ? ` (embedding profile ${profile})` : '';
  const provider = String(env.EMBEDDING_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  if (provider === 'api') {
    // No worker involved; the embedding client validates the key/model when the app starts.
    console.log(
      `[seed:demo] EMBEDDING_PROVIDER=api${via}: texts of the demo documents will be sent to the embedding API (see README, "Using a hosted embedding API").`,
    );
    return;
  }
  const workerUrl = String(env.AI_WORKER_URL ?? '').trim();
  const base = workerUrl === '' ? 'http://127.0.0.1:8000' : workerUrl;
  const url = `${base.replace(/\/+$/, '')}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: the model may still be loading`,
      );
    }
  } catch (err) {
    throw new DemoSeedError(
      `AI worker is not ready at ${url} (${err instanceof Error ? err.message : String(err)}). ` +
        'Start it, or seed without --embed and run `npm run backfill:embeddings -- --inline` later. ' +
        'Nothing was written.',
    );
  }
}

async function resetDemoData(prisma: PrismaClient): Promise<void> {
  // Deleting the spaces cascades to documents, chunks, versions, links and document members.
  const spaces = await prisma.space.deleteMany({
    where: { name: { startsWith: DEMO_SPACE_PREFIX } },
  });
  const users = await prisma.user.deleteMany({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
  });
  console.log(
    `[seed:demo] Removed ${spaces.count} demo space(s) and ${users.count} demo user(s).`,
  );
}

async function hasDemoData(prisma: PrismaClient): Promise<boolean> {
  const [spaces, users] = await Promise.all([
    prisma.space.count({ where: { name: { startsWith: DEMO_SPACE_PREFIX } } }),
    prisma.user.count({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    }),
  ]);
  return spaces > 0 || users > 0;
}

async function insertPlan(
  prisma: PrismaClient,
  plan: DemoPlan,
  passwordHash: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.user.createMany({
        data: plan.users.map(({ id, email }) => ({ id, email, passwordHash })),
      });
      await tx.space.createMany({ data: plan.spaces });
      await tx.spaceMember.createMany({ data: plan.spaceMembers });
      // Parents come before their children in plan.documents.
      await tx.document.createMany({ data: plan.documents });
      await tx.documentMember.createMany({ data: plan.documentMembers });
      await tx.documentVersion.createMany({ data: plan.versions });
      await tx.documentChunk.createMany({ data: plan.chunks });
      await tx.documentLink.createMany({
        data: plan.links,
        skipDuplicates: true,
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** Embeds (inline) or enqueues the seeded documents only, never other documents in the database. */
async function embedDemoDocuments(
  plan: DemoPlan,
  mode: 'inline' | 'queue',
): Promise<boolean> {
  // The Nest modules read the environment when they are built, so set it before importing them.
  process.env.QUEUE_WORKER_ENABLED = 'false'; // this process only produces jobs
  process.env.EMBED_RECONCILE_INTERVAL_MS = '0';
  if (mode === 'inline') process.env.QUEUE_ENABLED = 'false'; // inline needs no Redis

  class SeedDemoHost {}
  const app = await NestFactory.createApplicationContext(
    {
      module: SeedDemoHost,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
        QueueModule,
      ],
    },
    { logger: ['warn', 'error'] },
  );
  let ok = true;
  try {
    if (mode === 'queue') {
      const queue = app.get(QueueService);
      let queued = 0;
      for (const doc of plan.embeddable) {
        if (
          await queue.enqueueEmbedDocument({
            documentId: doc.id,
            version: doc.version,
          })
        )
          queued++;
      }
      console.log(
        `[seed:demo] Enqueued ${queued}/${plan.embeddable.length} embedding job(s).`,
      );
      console.log(
        '[seed:demo] They are processed by a running API (or any process with QUEUE_WORKER_ENABLED).',
      );
      ok = queued === plan.embeddable.length;
    } else {
      const handler = app.get(EmbedDocumentHandler);
      const startedAt = Date.now();
      let done = 0;
      let failed = 0;
      for (const [index, doc] of plan.embeddable.entries()) {
        try {
          await handler.handle({ documentId: doc.id, version: doc.version });
          done++;
        } catch (err) {
          failed++;
          console.error(
            `[seed:demo] Embedding of ${doc.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        console.log(
          `[seed:demo] embedded ${index + 1}/${plan.embeddable.length} documents ` +
            `(${formatDuration((Date.now() - startedAt) / 1000)} elapsed)`,
        );
      }
      console.log(
        `[seed:demo] Embedding finished: ${done} ok, ${failed} failed.`,
      );
      if (failed > 0) {
        console.log(
          '[seed:demo] Retry the failed ones with: npm run backfill:embeddings -- --inline',
        );
      }
      ok = failed === 0;
    }
  } finally {
    await app.close();
  }
  return ok;
}

function printSummary(
  plan: DemoPlan,
  options: DemoOptions,
  password: string,
): void {
  const s = plan.stats;
  const langs = Object.entries(s.byLanguage)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const topics = Object.entries(s.byTopic)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  console.log(`
[seed:demo] Done.
  documents  ${s.documents} (${s.published} published, ${s.drafts} drafts, ${s.archived} archived, ${s.withHistory} with 2 versions)
  languages  ${langs}
  topics     ${topics}
  chunks     ${s.chunks}    links ${s.links}    text ${Math.round(s.characters / 1000)}k characters
  spaces     ${plan.spaces.map((sp) => sp.name).join(', ')}

  Demo users (password: ${password}):
${plan.users.map((u) => `    ${u.email}`).join('\n')}
    anna = owner of Programming, ivan = owner of Mathematics and Finance, maria/oleg/kate = editor/viewer/outsider
    (kate has access to a few single documents only).`);
  if (options.embed === 'none') {
    console.log(`
  Vectors were NOT created. Add --embed to create them, or run: npm run backfill:embeddings -- --inline
  A running API embeds these documents by itself ~10 s after start unless EMBED_RECONCILE_INTERVAL_MS=0.`);
  }
}

async function main(): Promise<void> {
  const options = parseDemoArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  loadDotEnv(); // before the guard: .env may set NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    throw new DemoSeedError(
      'Refusing to add demo data with NODE_ENV=production',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new DemoSeedError('DATABASE_URL is not set');
  const password =
    options.password ?? process.env.SEED_DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;
  if (
    password.length < 10 ||
    Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
  ) {
    throw new DemoSeedError(
      `The demo password must have at least 10 characters and at most ${PASSWORD_MAX_BYTES} bytes`,
    );
  }

  const corpusDir = resolve(
    options.corpusDir ?? join(__dirname, '..', '..', 'prisma', 'demo-data'),
  );
  const corpus = selectCorpus(loadCorpus(corpusDir), options);
  if (corpus.length === 0) {
    throw new DemoSeedError(
      `No corpus files for ${options.languages.join(',')} / ${options.topics.join(',')} in ${corpusDir}`,
    );
  }
  const plan = buildDemoPlan(corpus, { seed: options.seed });
  for (const warning of plan.warnings)
    console.warn(`[seed:demo] warning: ${warning}`);

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    if (!options.reset && (await hasDemoData(prisma))) {
      if (options.ifMissing) {
        console.log(
          '[seed:demo] Demo data already present, skipping. Re-run with --reset to replace it (via dev.sh: ./dev.sh seed --reseed).',
        );
        return; // nothing written, no embedding either
      }
      throw new DemoSeedError(
        'Demo data already exists. Re-run with --reset to replace it.',
      );
    }
    // Checked before anything is written (the reset below included).
    if (options.embed === 'inline') {
      await checkWorker();
      console.log(
        `[seed:demo] Will embed ${plan.chunks.length} chunk(s); expect roughly ` +
          `${formatDuration(plan.chunks.length * SECONDS_PER_CHUNK)} on a local MLX worker (much faster with a GPU worker or an API).`,
      );
    }
    if (options.reset) await resetDemoData(prisma);
    await insertPlan(prisma, plan, await hashPassword(password));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
  printSummary(plan, options, password);

  if (options.embed !== 'none') {
    const ok = await embedDemoDocuments(plan, options.embed);
    if (!ok) process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(
    err instanceof DemoSeedError
      ? `[seed:demo] ${err.message}`
      : `[seed:demo] Failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
