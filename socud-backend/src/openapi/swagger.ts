import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

export const DOCS_PATH = 'api/docs';
export const DOCS_JSON_PATH = 'api/docs-json';

/** Name of the bearer security scheme (access token in `Authorization: Bearer ...`). */
export const BEARER_SCHEME = 'bearer';
/** Name of the cookie security scheme (httpOnly refresh token). */
export const REFRESH_COOKIE_SCHEME = 'refresh-cookie';
/** Keep in sync with REFRESH_COOKIE_NAME in auth.controller.ts (asserted by a spec). */
export const REFRESH_COOKIE_SCHEME_NAME = 'socud_refresh';

/**
 * Swagger UI is served unless NODE_ENV=production; SWAGGER_ENABLED overrides either way.
 */
export function isSwaggerEnabled(env: {
  SWAGGER_ENABLED?: boolean;
  NODE_ENV?: string;
}): boolean {
  return env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
}

/**
 * The single OpenAPI document definition, shared by main.ts, `npm run openapi:export` and the specs,
 * so the committed openapi.json cannot drift from what the running server serves.
 * Must stay deterministic (no dates, no env-dependent values): CI diffs the exported file.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('SOCUD API')
    .setDescription(
      'REST API of the SOCUD knowledge base. Real-time editing runs over a separate Hocuspocus WebSocket and is not part of this document.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Short-lived access token from POST /auth/login or /auth/refresh.',
      },
      BEARER_SCHEME,
    )
    .addCookieAuth(
      REFRESH_COOKIE_SCHEME_NAME,
      {
        type: 'apiKey',
        in: 'cookie',
        name: REFRESH_COOKIE_SCHEME_NAME,
        description:
          'httpOnly refresh-token cookie (path /auth) set by login/refresh; send with credentials.',
      },
      REFRESH_COOKIE_SCHEME,
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

/**
 * CSP for the docs page only. Swagger UI needs inline styles; scripts are served from 'self'.
 * Every other route keeps the strict helmet() policy from main.ts. No `upgrade-insecure-requests`
 * (it breaks http://localhost in Safari).
 */
export const DOCS_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Express middleware: relaxes the CSP for /api/docs* only. Register after helmet(). */
export function docsCspMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.path === '/api/docs' ||
    req.path.startsWith('/api/docs/') ||
    req.path === '/api/docs-json'
  ) {
    res.setHeader('Content-Security-Policy', DOCS_CONTENT_SECURITY_POLICY);
  }
  next();
}

/** Mounts Swagger UI + JSON. Call after helmet() and before listen(). */
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  app.use(docsCspMiddleware);
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: DOCS_JSON_PATH,
    customSiteTitle: 'SOCUD API',
    swaggerOptions: { persistAuthorization: true },
  });
  return document;
}
