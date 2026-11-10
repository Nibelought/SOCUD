import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController, HEALTH_DB_TIMEOUT_MS } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  const queryRaw = jest.fn();

  beforeEach(async () => {
    queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  afterEach(() => jest.useRealTimers());

  it('reports ok when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      db: 'up',
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the database ping fails, without leaking the error', async () => {
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const err = await controller.check().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toEqual({
      status: 'error',
      db: 'down',
    });
  });

  it('answers 503 when the database ping hangs', async () => {
    jest.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => undefined));
    const result = controller.check().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS + 1);
    expect(await result).toBeInstanceOf(ServiceUnavailableException);
  });
});
