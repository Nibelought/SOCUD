import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createConfigServiceMock } from '../test-utils/mocks';
import { QueueService, isQueueEnabled } from './queue.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock('./redis', () => ({
  DEFAULT_REDIS_URL: 'redis://default',
  createProducerConnection: jest.fn(() => ({ disconnect: jest.fn() })),
}));

const queueMock = {
  add: jest.fn(),
  getJob: jest.fn(),
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

function build(overrides: Record<string, unknown> = {}) {
  return new QueueService(
    createConfigServiceMock(overrides) as unknown as ConfigService,
  );
}

describe('QueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Queue as unknown as jest.Mock).mockImplementation(() => queueMock);
    queueMock.getJob.mockResolvedValue(undefined);
    queueMock.add.mockResolvedValue({});
  });

  it('is disabled in the test environment by default (no Redis connection)', () => {
    const service = build({ NODE_ENV: 'test' });
    service.onModuleInit();
    expect(service.enabled).toBe(false);
    expect(Queue).not.toHaveBeenCalled();
  });

  it('can be enabled explicitly, and disabled outside tests', () => {
    expect(
      isQueueEnabled(createConfigServiceMock({ QUEUE_ENABLED: true }) as never),
    ).toBe(true);
    expect(
      isQueueEnabled(
        createConfigServiceMock({ NODE_ENV: 'development' }) as never,
      ),
    ).toBe(true);
    expect(
      isQueueEnabled(
        createConfigServiceMock({
          NODE_ENV: 'development',
          QUEUE_ENABLED: false,
        }) as never,
      ),
    ).toBe(false);
  });

  it('returns false without throwing when the queue is disabled', async () => {
    const service = build({ NODE_ENV: 'test' });
    service.onModuleInit();
    await expect(
      service.enqueueEmbedDocument({ documentId: 'd', version: 1 }),
    ).resolves.toBe(false);
  });

  describe('enabled', () => {
    let service: QueueService;
    beforeEach(() => {
      service = build({ QUEUE_ENABLED: true });
      service.onModuleInit();
    });

    it('configures retries with exponential backoff', () => {
      const [, options] = (Queue as unknown as jest.Mock).mock.calls[0] as [
        string,
        { defaultJobOptions: Record<string, unknown> },
      ];
      expect(options.defaultJobOptions).toMatchObject({
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      });
    });

    it('enqueues with a job id keyed by document and version (idempotent)', async () => {
      await expect(
        service.enqueueEmbedDocument({ documentId: 'doc', version: 7 }),
      ).resolves.toBe(true);
      expect(queueMock.add).toHaveBeenCalledWith(
        'embed-document',
        { documentId: 'doc', version: 7 },
        { jobId: 'embed-doc-7' },
      );
    });

    it('replaces a permanently failed job with the same id', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      queueMock.getJob.mockResolvedValue({
        isFailed: () => Promise.resolve(true),
        remove,
      });
      await service.enqueueEmbedDocument({ documentId: 'doc', version: 7 });
      expect(remove).toHaveBeenCalled();
      expect(queueMock.add).toHaveBeenCalled();
    });

    it('leaves an existing waiting/active job alone', async () => {
      const remove = jest.fn();
      queueMock.getJob.mockResolvedValue({
        isFailed: () => Promise.resolve(false),
        remove,
      });
      await service.enqueueEmbedDocument({ documentId: 'doc', version: 7 });
      expect(remove).not.toHaveBeenCalled();
    });

    it('returns false (and does not throw) when Redis rejects the job', async () => {
      queueMock.add.mockRejectedValue(new Error('Connection is closed'));
      await expect(
        service.enqueueEmbedDocument({ documentId: 'doc', version: 1 }),
      ).resolves.toBe(false);
    });

    it('gives up after a timeout when Redis hangs', async () => {
      jest.useFakeTimers();
      try {
        queueMock.add.mockReturnValue(new Promise(() => undefined));
        const result = service.enqueueEmbedDocument({
          documentId: 'doc',
          version: 1,
        });
        await jest.advanceTimersByTimeAsync(3_500);
        await expect(result).resolves.toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('closes the queue on shutdown', async () => {
      await service.onModuleDestroy();
      expect(queueMock.close).toHaveBeenCalled();
    });
  });
});
