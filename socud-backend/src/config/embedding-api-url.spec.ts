import {
  assessEmbeddingApiUrl,
  isLoopbackHost,
  isPrivateHost,
} from './embedding-api-url';

describe('assessEmbeddingApiUrl', () => {
  it('accepts https URLs without a warning', () => {
    expect(assessEmbeddingApiUrl('https://openrouter.ai/api/v1')).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(
      assessEmbeddingApiUrl('https://openrouter.ai/api/v1'),
    ).not.toHaveProperty('warning');
  });

  it('accepts http to loopback silently', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '127.5.5.5']) {
      const result = assessEmbeddingApiUrl(`http://${host}:1234/v1`);
      expect(result.ok).toBe(true);
      expect(result).not.toHaveProperty('warning');
    }
  });

  it('accepts http to a private host with a warning', () => {
    for (const host of [
      '192.168.1.50',
      '10.0.0.7',
      '172.16.3.4',
      '172.31.255.1',
      '100.64.0.9',
      'host.docker.internal',
      'ollama',
      'gpu-box.local',
    ]) {
      const result = assessEmbeddingApiUrl(`http://${host}:8000/v1`);
      expect(result.ok).toBe(true);
      expect(result.ok && result.warning).toMatch(/unencrypted/);
    }
  });

  it('rejects http to a public host', () => {
    for (const url of [
      'http://openrouter.ai/api/v1',
      'http://8.8.8.8/v1',
      'http://172.32.0.1/v1',
      'http://api.example.com/v1',
    ]) {
      const result = assessEmbeddingApiUrl(url);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(/Use https:\/\//);
    }
  });

  it('rejects garbage, other schemes and embedded credentials', () => {
    expect(assessEmbeddingApiUrl('not a url').ok).toBe(false);
    expect(assessEmbeddingApiUrl('ftp://example.com/v1').ok).toBe(false);
    const withCreds = assessEmbeddingApiUrl('https://user:pw@example.com/v1');
    expect(withCreds.ok).toBe(false);
    expect(!withCreds.ok && withCreds.error).toMatch(/credentials/);
  });
});

describe('host classification', () => {
  it('knows loopback', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('192.168.0.1')).toBe(false);
  });

  it('knows IPv6 private ranges', () => {
    expect(isPrivateHost('[fd12:3456::1]')).toBe(true);
    expect(isPrivateHost('[fe80::1]')).toBe(true);
    expect(isPrivateHost('[2606:4700::1111]')).toBe(false);
  });
});
