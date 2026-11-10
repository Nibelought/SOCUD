import './export-env';
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import request from 'supertest';
import { AppModule } from '../app.module';
import { REFRESH_COOKIE_NAME } from '../auth/auth.controller';
import {
  BEARER_SCHEME,
  DOCS_CONTENT_SECURITY_POLICY,
  REFRESH_COOKIE_SCHEME,
  REFRESH_COOKIE_SCHEME_NAME,
  buildOpenApiDocument,
  isSwaggerEnabled,
  setupSwagger,
} from './swagger';

// `@hocuspocus/server` pulls in an ESM-only dependency Jest cannot load; only the route table is read.
jest.mock('@hocuspocus/server', () => ({ Server: class {} }));

const SRC = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** Every controller class in src/ with its route handler method names. */
function discoverControllers(): { name: string; handlers: string[] }[] {
  return controllerFiles(SRC).flatMap((file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    return Object.values(mod)
      .filter(
        (value): value is new (...args: never[]) => unknown =>
          typeof value === 'function' &&
          Reflect.hasMetadata(PATH_METADATA, value) &&
          !Reflect.hasMetadata(METHOD_METADATA, value),
      )
      .map((cls) => ({
        name: cls.name,
        handlers: Object.getOwnPropertyNames(cls.prototype).filter(
          (key) =>
            key !== 'constructor' &&
            Reflect.hasMetadata(METHOD_METADATA, cls.prototype[key as never]),
        ),
      }));
  });
}

const operations = (doc: OpenAPIObject) =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Record<string, unknown>>)
      .filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(method),
      )
      .map(([method, op]) => ({ path, method, op })),
  );

describe('OpenAPI document', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    // preview: routes are registered, providers are never built (no database / Redis / sockets).
    app = await NestFactory.create(AppModule, {
      preview: true,
      abortOnError: false,
      logger: false,
    });
    doc = buildOpenApiDocument(app);
  });

  it('documents every route handler of every controller in src/', () => {
    const controllers = discoverControllers();
    expect(controllers.length).toBeGreaterThanOrEqual(5);

    const ids = new Set(
      operations(doc).map(({ op }) => op.operationId as string),
    );
    const expected = controllers.flatMap(({ name, handlers }) =>
      handlers.map((h) => `${name.replace(/Controller$/, '')}_${h}`),
    );
    expect(expected.length).toBeGreaterThan(20);
    expect(expected.filter((id) => !ids.has(id))).toEqual([]);
    expect(ids.size).toBe(expected.length);
  });

  it('declares the bearer and refresh-cookie security schemes', () => {
    const schemes = doc.components?.securitySchemes as Record<string, object>;
    expect(schemes[BEARER_SCHEME]).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(schemes[REFRESH_COOKIE_SCHEME]).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: REFRESH_COOKIE_NAME,
    });
    expect(REFRESH_COOKIE_SCHEME_NAME).toBe(REFRESH_COOKIE_NAME);
  });

  it('tags every operation and gives it a summary', () => {
    for (const { path, method, op } of operations(doc)) {
      expect({ path, method, tags: op.tags }).toEqual({
        path,
        method,
        tags: [expect.any(String)],
      });
      expect({ path, method, summary: typeof op.summary }).toEqual({
        path,
        method,
        summary: 'string',
      });
    }
    const tags = new Set(
      operations(doc).flatMap(({ op }) => op.tags as string[]),
    );
    expect([...tags].sort()).toEqual(
      ['app', 'auth', 'document', 'health', 'space'].sort(),
    );
  });

  it('requires the bearer scheme and documents 401 on all space/document routes and user search', () => {
    const protectedOps = operations(doc).filter(
      ({ path }) =>
        path.startsWith('/space') ||
        path.startsWith('/document') ||
        path === '/auth/users/search',
    );
    expect(protectedOps.length).toBeGreaterThan(20);
    for (const { path, method, op } of protectedOps) {
      expect({ path, method, security: op.security }).toEqual({
        path,
        method,
        security: [{ [BEARER_SCHEME]: [] }],
      });
      expect(Object.keys(op.responses as object)).toContain('401');
    }
  });

  it('keeps register/login/health public and refresh/logout on the cookie scheme', () => {
    const byPath = (p: string, m: string) =>
      (doc.paths[p] as Record<string, { security?: unknown }>)[m];
    expect(byPath('/auth/register', 'post').security).toBeUndefined();
    expect(byPath('/auth/login', 'post').security).toBeUndefined();
    expect(byPath('/health', 'get').security).toBeUndefined();
    expect(byPath('/auth/refresh', 'post').security).toEqual([
      { [REFRESH_COOKIE_SCHEME]: [] },
    ]);
    expect(byPath('/auth/logout', 'post').security).toEqual([
      { [REFRESH_COOKIE_SCHEME]: [] },
    ]);
  });

  it('documents the versions endpoints and the typed login response', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/document/{id}/versions',
        '/document/{id}/versions/{version}',
        '/document/{id}/publish',
      ]),
    );
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas).toHaveProperty('LoginResponseDto');
    expect(schemas).toHaveProperty('ErrorResponseDto');
  });

  it('is serialisable deterministically', () => {
    const again = buildOpenApiDocument(app);
    expect(JSON.stringify(again)).toBe(JSON.stringify(doc));
  });

  it('matches the committed openapi.json route table', () => {
    // Full byte equality is enforced in CI (`npm run openapi:export` + git diff): the DTO schemas
    // need the Nest CLI plugin, which Jest does not run. Paths and operation ids do not.
    const committed = JSON.parse(
      readFileSync(join(SRC, '..', 'openapi.json'), 'utf8'),
    ) as OpenAPIObject;
    const routes = (d: OpenAPIObject) =>
      operations(d)
        .map(
          ({ path, method, op }) =>
            `${method} ${path} ${String(op.operationId)}`,
        )
        .sort();
    expect(routes(committed)).toEqual(routes(doc));
  });
});

describe('isSwaggerEnabled', () => {
  it('defaults to on outside production and off in production', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isSwaggerEnabled({})).toBe(true);
  });

  it('SWAGGER_ENABLED overrides the default both ways', () => {
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: true }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: false }),
    ).toBe(false);
  });
});

describe('Swagger UI over HTTP', () => {
  @Controller('ping')
  class PingController {
    @Get()
    ping() {
      return { ok: true };
    }
  }

  const boot = async (docs: boolean) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    const nest = moduleRef.createNestApplication();
    // Same order as main.ts: strict helmet first, docs setup after.
    nest.use(helmet());
    if (docs) setupSwagger(nest);
    await nest.init();
    return nest;
  };

  it('serves the UI and JSON when enabled, with a docs-only CSP', async () => {
    const nest = await boot(true);
    try {
      const json = await request(nest.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      expect((json.body as OpenAPIObject).paths).toHaveProperty('/ping');
      expect(json.headers['content-security-policy']).toBe(
        DOCS_CONTENT_SECURITY_POLICY,
      );

      const ui = await request(nest.getHttpServer())
        .get('/api/docs')
        .expect(200);
      expect(ui.text).toContain('swagger-ui');
      expect(ui.headers['content-security-policy']).toBe(
        DOCS_CONTENT_SECURITY_POLICY,
      );

      // Any other route keeps helmet's strict default policy (no relaxation leaks out).
      const other = await request(nest.getHttpServer())
        .get('/ping')
        .expect(200);
      const csp = String(other.headers['content-security-policy']);
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).not.toBe(DOCS_CONTENT_SECURITY_POLICY);
    } finally {
      await nest.close();
    }
  });

  it('serves no docs when not set up (disabled)', async () => {
    const nest = await boot(false);
    try {
      await request(nest.getHttpServer()).get('/api/docs-json').expect(404);
      await request(nest.getHttpServer()).get('/api/docs').expect(404);
    } finally {
      await nest.close();
    }
  });
});
