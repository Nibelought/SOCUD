import { ConfigService } from '@nestjs/config';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { createConfigServiceMock } from '../test-utils/mocks';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingError } from './embedding.client';
import { EmbeddingWorker } from './embedding.worker';
import type { EmbedDocumentJobData } from './queue.constants';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock('./redis', () => ({
  DEFAULT_REDIS_URL: 'redis://default',
  createWorkerConnection: jest.fn(() => ({ disconnect: jest.fn() })),
}));

const job = (name = 'embed-document') =>
  ({
    name,
    data: { documentId: 'd', version: 1 },
  }) as Job<EmbedDocumentJobData>;

describe('EmbeddingWorker', () => {
  let handler: { handle: jest.Mock };
  const build = (overrides: Record<string, unknown> = {}) =>
    new EmbeddingWorker(
      createConfigServiceMock(overrides) as unknown as ConfigService,
      handler as unknown as EmbedDocumentHandler,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    handler = { handle: jest.fn().mockResolvedValue({ status: 'done' }) };
  });

  it('does not start a consumer in tests', () => {
    build({ NODE_ENV: 'test' }).onModuleInit();
    expect(Worker).not.toHaveBeenCalled();
  });

  it('does not start a consumer when QUEUE_WORKER_ENABLED=false', () => {
    build({ QUEUE_ENABLED: true, QUEUE_WORKER_ENABLED: false }).onModuleInit();
    expect(Worker).not.toHaveBeenCalled();
  });

  it('starts a consumer with the configured concurrency', () => {
    (Worker as unknown as jest.Mock).mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn(),
    }));
    build({ QUEUE_ENABLED: true, EMBED_CONCURRENCY: 2 }).onModuleInit();
    expect(Worker).toHaveBeenCalledWith(
      'embeddings',
      expect.any(Function),
      expect.objectContaining({ concurrency: 2 }),
    );
  });

  it('runs the handler for embed-document jobs', async () => {
    await expect(build().process(job())).resolves.toEqual({ status: 'done' });
    expect(handler.handle).toHaveBeenCalledWith({
      documentId: 'd',
      version: 1,
    });
  });

  it('retries on retryable worker errors (rethrows as is)', async () => {
    const err = new EmbeddingError('500', true, 500);
    handler.handle.mockRejectedValue(err);
    await expect(build().process(job())).rejects.toBe(err);
  });

  it('does not retry permanent worker errors (422, wrong dimension)', async () => {
    handler.handle.mockRejectedValue(new EmbeddingError('422', false, 422));
    await expect(build().process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('fails unknown jobs permanently', async () => {
    await expect(build().process(job('other'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
