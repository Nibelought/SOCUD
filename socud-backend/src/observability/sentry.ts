import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';

const REDACTED_HEADERS = ['authorization', 'cookie', 'x-worker-token'];

/** Removes anything that could carry credentials or personal data from an outgoing event. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (REDACTED_HEADERS.includes(name.toLowerCase())) {
          delete event.request.headers[name];
        }
      }
    }
  }
  delete event.user;
  return event;
}

export interface SentryEnv {
  SENTRY_DSN?: string;
  NODE_ENV?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
}

/** Initialises Sentry only when SENTRY_DSN is set. Returns whether it is enabled. */
export function initSentry(env: SentryEnv): boolean {
  if (!env.SENTRY_DSN) return false;
  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE);
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV ?? 'development',
    // Opt out of every optional data category: only the error, stack trace and route are sent.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 0,
    beforeSend: scrubEvent,
  });
  return true;
}
