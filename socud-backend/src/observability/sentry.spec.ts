import type { ErrorEvent } from '@sentry/nestjs';
import * as Sentry from '@sentry/nestjs';
import { initSentry, scrubEvent } from './sentry';

jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));

describe('initSentry', () => {
  beforeEach(() => jest.mocked(Sentry.init).mockClear());

  it('does nothing without SENTRY_DSN', () => {
    expect(initSentry({})).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initialises with PII collection disabled when SENTRY_DSN is set', () => {
    expect(initSentry({ SENTRY_DSN: 'https://k@example.com/1' })).toBe(true);
    const options = jest.mocked(Sentry.init).mock.calls[0][0];
    expect(options?.dsn).toBe('https://k@example.com/1');
    expect(options?.tracesSampleRate).toBe(0);
    expect(options?.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
    });
    expect(options?.beforeSend).toBe(scrubEvent);
  });

  it('accepts a valid trace sample rate only', () => {
    initSentry({ SENTRY_DSN: 'x', SENTRY_TRACES_SAMPLE_RATE: '0.25' });
    initSentry({ SENTRY_DSN: 'x', SENTRY_TRACES_SAMPLE_RATE: '7' });
    const calls = jest.mocked(Sentry.init).mock.calls;
    expect(calls[0][0]?.tracesSampleRate).toBe(0.25);
    expect(calls[1][0]?.tracesSampleRate).toBe(0);
  });
});

describe('scrubEvent', () => {
  it('drops cookies, bodies, query strings, credential headers and the user', () => {
    const event = {
      request: {
        cookies: { refresh_token: 'x' },
        data: { password: 'x' },
        query_string: 'token=x',
        headers: {
          Authorization: 'Bearer x',
          'X-Worker-Token': 'x',
          Accept: '*/*',
        },
      },
      user: { email: 'a@b.c' },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.request).toEqual({ headers: { Accept: '*/*' } });
    expect(out.user).toBeUndefined();
  });
});
