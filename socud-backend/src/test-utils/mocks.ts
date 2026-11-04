import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** Env values used by unit tests (never real secrets). */
export const TEST_ENV: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'test-access-secret-0123456789abcdef0123',
  PORT: 3000,
  WS_PORT: 3002,
  AI_WORKER_URL: 'http://ai-worker.test',
  CORS_ORIGIN: 'http://localhost:3001',
  NODE_ENV: 'test',
};

/** Provider-ready ConfigService mock backed by a plain object. */
export function createConfigServiceMock(
  overrides: Record<string, unknown> = {},
) {
  const values = { ...TEST_ENV, ...overrides };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) {
        throw new Error(`Configuration key "${key}" does not exist`);
      }
      return values[key];
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

/** Minimal PrismaService mock covering the models/methods touched by unit tests. */
export function createPrismaServiceMock() {
  return {
    user: { findUnique: jest.fn(), create: jest.fn() },
    space: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    spaceMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    document: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    documentMember: { upsert: jest.fn(), delete: jest.fn() },
    documentChunk: { deleteMany: jest.fn() },
    documentLink: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  } as unknown as jest.Mocked<PrismaService>;
}
