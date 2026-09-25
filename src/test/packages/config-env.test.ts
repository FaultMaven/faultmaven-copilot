import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Build-time numeric knobs fall back to their defaults when unparseable.
 *
 * `parseInt('abc')` is NaN, and NaN is worse than a wrong number: it passes
 * through `Math.min`/`Math.max` untouched, so the session-timeout clamp
 * (60–480, ClientSessionManager) let it through and the session request went
 * out as `timeout_minutes: null`. A value that is not a number must mean "not
 * set", which is the only reading under which `.env.example`'s "clamped" holds.
 */
async function loadConfig() {
  vi.resetModules();
  return (await import('@faultmaven/copilot-ui/config')).default;
}

describe('config env parsing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honours a numeric VITE_SESSION_TIMEOUT_MINUTES', async () => {
    vi.stubEnv('VITE_SESSION_TIMEOUT_MINUTES', '240');
    const config = await loadConfig();
    expect(config.session.timeoutMinutes).toBe(240);
    expect(config.session.timeoutMs).toBe(240 * 60 * 1000);
  });

  it.each(['abc', '', '  ', 'NaN'])(
    'falls back to the 180-minute default for VITE_SESSION_TIMEOUT_MINUTES=%j',
    async (value) => {
      vi.stubEnv('VITE_SESSION_TIMEOUT_MINUTES', value);
      const config = await loadConfig();
      expect(config.session.timeoutMinutes).toBe(180);
      expect(config.session.timeoutMs).toBe(180 * 60 * 1000);
    }
  );

  it('falls back to the defaults for unparseable input limits', async () => {
    vi.stubEnv('VITE_DATA_MODE_LINES', 'many');
    vi.stubEnv('VITE_MAX_QUERY_LENGTH', 'lots');
    vi.stubEnv('VITE_MAX_FILE_SIZE_MB', 'big');
    const config = await loadConfig();
    expect(config.inputLimits.dataModeLinesThreshold).toBe(100);
    expect(config.inputLimits.maxQueryLength).toBe(200000);
    expect(config.inputLimits.maxFileSize).toBe(10 * 1024 * 1024);
  });
});
