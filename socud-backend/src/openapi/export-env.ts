// Imported first by export-openapi.ts: ConfigModule validates the environment while AppModule is
// imported, so placeholders must exist by then. Nothing here is ever used to connect anywhere.
process.env.DATABASE_URL ??=
  'postgresql://openapi:openapi@127.0.0.1:5432/openapi';
process.env.JWT_SECRET ??= 'openapi-export-placeholder-secret-0123456789';
process.env.NODE_ENV = 'test';
