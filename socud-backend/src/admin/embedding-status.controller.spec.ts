import {
  INestApplication,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionService } from '../permission/permission.service';
import { SystemAdminGuard } from '../permission/system-admin.guard';
import {
  EmbeddingModelGuard,
  type EmbeddingStatus,
} from '../queue/embedding-model.guard';
import { EmbeddingStatusController } from './embedding-status.controller';

const STATUS: EmbeddingStatus = {
  activeModel: 'openai/text-embedding-3-small@1024',
  provider: 'api',
  dim: 1024,
  stored: [{ model: 'qwen3-embedding-4b@1024', chunks: 120, documents: 14 }],
  mismatch: true,
  recommendedActions: ['a', 'b', 'c'],
};

/** Stands in for the passport JWT guard: `x-user` header = authenticated user id. */
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: { id: string };
    }>();
    const id = req.headers['x-user'];
    if (!id) return false; // Nest answers 403 for a falsy guard; the real one answers 401
    req.user = { id };
    return true;
  }
}

describe('GET /admin/embedding-status', () => {
  let app: INestApplication<App>;
  let modelGuard: { getStatus: jest.Mock };
  let permissions: { isSystemAdmin: jest.Mock };

  beforeEach(async () => {
    modelGuard = { getStatus: jest.fn().mockResolvedValue(STATUS) };
    permissions = {
      isSystemAdmin: jest.fn((id: string) => Promise.resolve(id === 'admin')),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EmbeddingStatusController],
      providers: [
        SystemAdminGuard,
        { provide: PermissionService, useValue: permissions },
        { provide: EmbeddingModelGuard, useValue: modelGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('returns the contract shape to a system admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/embedding-status')
      .set('x-user', 'admin')
      .expect(200);
    expect(res.body).toEqual(STATUS);
    expect(Object.keys(res.body as object).sort()).toEqual(
      [
        'activeModel',
        'dim',
        'mismatch',
        'provider',
        'recommendedActions',
        'stored',
      ].sort(),
    );
  });

  it('answers 403 to a signed-in non-admin and never computes the status', async () => {
    await request(app.getHttpServer())
      .get('/admin/embedding-status')
      .set('x-user', 'someone')
      .expect(403);
    expect(modelGuard.getStatus).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/admin/embedding-status')
      .expect((res) => expect([401, 403]).toContain(res.status));
    expect(modelGuard.getStatus).not.toHaveBeenCalled();
  });
});
