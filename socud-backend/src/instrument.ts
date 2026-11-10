// Imported first by main.ts so Sentry can instrument modules loaded afterwards.
// `.env` is read here because Nest's ConfigModule has not run yet; existing variables win.
import { initSentry } from './observability/sentry';

try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. in a container, where variables come from the environment).
}

initSentry(process.env);
