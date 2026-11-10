/**
 * Writes the OpenAPI document to a file without a database, Redis or network:
 * the app is created in Nest's `preview` mode (modules and routes are registered, providers are
 * never instantiated, no lifecycle hooks run).
 *
 * Run through `npm run openapi:export` (nest build first): the @nestjs/swagger CLI plugin that
 * introspects the DTOs only runs inside `nest build`, so ts-node would produce an incomplete document.
 *
 * Usage: node dist/openapi/export-openapi.js [outputPath]   (default: ./openapi.json)
 */
import './export-env'; // must stay the first import
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './swagger';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    abortOnError: false,
    logger: false,
  });
  const document = buildOpenApiDocument(app);
  const out = resolve(process.argv[2] ?? 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  console.log(`OpenAPI document written to ${out}`);
  // No app.close(): nothing was initialised, and some modules keep handles open.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
