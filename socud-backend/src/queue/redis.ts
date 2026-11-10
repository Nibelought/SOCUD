import { Logger } from '@nestjs/common';
import IORedis, { type RedisOptions } from 'ioredis';

export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/** Logs connection errors at most once per interval instead of on every reconnect attempt. */
export function attachThrottledErrorLog(
  connection: IORedis,
  logger: Logger,
  label: string,
  intervalMs = 30_000,
): void {
  let last = 0;
  connection.on('error', (err: Error) => {
    const now = Date.now();
    if (now - last >= intervalMs) {
      last = now;
      logger.warn(`Redis (${label}) error: ${err.message}`);
    }
  });
}

/**
 * Producer connection: fails fast while Redis is down (no offline queue), so a Publish request
 * never waits for Redis.
 */
export function createProducerConnection(url: string, logger: Logger): IORedis {
  const options: RedisOptions = {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    // Keep trying to reconnect in the background, with a capped delay.
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  };
  const connection = new IORedis(url, options);
  attachThrottledErrorLog(connection, logger, 'producer');
  return connection;
}

/** Consumer connection: BullMQ workers require `maxRetriesPerRequest: null` (blocking commands). */
export function createWorkerConnection(url: string, logger: Logger): IORedis {
  const connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  attachThrottledErrorLog(connection, logger, 'worker');
  return connection;
}
