import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

export const HEALTH_DB_TIMEOUT_MS = 2000;

/** Unauthenticated liveness/readiness probe for Docker and load balancers. */
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up' }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('database ping timed out')),
            HEALTH_DB_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'ok', db: 'up' };
    } catch (err) {
      this.logger.warn(
        `Health check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    } finally {
      clearTimeout(timer);
    }
  }
}
