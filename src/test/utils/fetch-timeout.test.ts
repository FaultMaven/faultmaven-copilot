import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../../lib/utils/fetch-timeout';

/** A fetch mock that never resolves until its AbortSignal fires. */
function hangingFetch() {
  return vi.fn().mockImplementation((_input: any, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err: Error & { name: string } = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
}

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns the response on success and forwards an abort signal', async () => {
    const res = { ok: true } as Response;
    global.fetch = vi.fn().mockResolvedValue(res);

    const out = await fetchWithTimeout('https://x/y', { method: 'GET' }, 5000);

    expect(out).toBe(res);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x/y',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
  });

  it('rejects with TimeoutError when the request exceeds the timeout', async () => {
    vi.useFakeTimers();
    global.fetch = hangingFetch();

    const p = fetchWithTimeout('https://x/y', {}, 1000);
    const assertion = expect(p).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('propagates caller-initiated cancellation (not as a timeout)', async () => {
    const controller = new AbortController();
    global.fetch = hangingFetch();

    const p = fetchWithTimeout('https://x/y', { signal: controller.signal }, 10000);
    controller.abort();

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
