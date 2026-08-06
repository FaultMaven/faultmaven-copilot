/**
 * The backend's two error-body shapes, and the one place that knows both (fm#994).
 *
 * FastAPI handlers put the human-readable text in `detail`. The backend's
 * protection middleware answers with `ProtectionErrorResponse`, which has no
 * `detail` field at all and puts the text in `message` — that is every 429 from
 * rate limiting and the 409/503 from deduplication. Twelve call sites had each
 * written their own `errorData.detail || …` chain, so a rate-limited request
 * reported a generic fallback and the server's own text was thrown away.
 *
 * The fix is one reader, not twelve fixed chains. These tests cover:
 *
 * 1. The reader's contract, including the case that made it a function rather
 *    than an inline `||`: a 422 puts an **array** in `detail`, and using it as a
 *    message rendered "[object Object]".
 * 2. `createHttpErrorFromResponse`, the raw-fetch path shared by
 *    `heartbeatSession` and the auth / case / knowledge / session services.
 * 3. That no call site has grown its own chain again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { errorBodyText } from '../../../lib/errors/error-body';
import { createHttpErrorFromResponse } from '../../../lib/errors/http-error';

/** A Response stand-in: only what `createHttpErrorFromResponse` reads. */
function fakeResponse(
  status: number,
  body: unknown,
  { statusText = '', headers = {} as Record<string, string> } = {}
): Response {
  return {
    status,
    statusText,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (body === undefined) throw new SyntaxError('not json');
      return body;
    },
  } as unknown as Response;
}

describe('errorBodyText — the reader for both body shapes', () => {
  it('reads FastAPI `detail`', () => {
    expect(errorBodyText({ detail: 'Case not found' })).toBe('Case not found');
  });

  it('reads the protection middleware`s `message` when there is no `detail`', () => {
    expect(
      errorBodyText({
        error: 'rate_limit_exceeded',
        message: 'Rate limit exceeded: 121/120 requests',
        retry_after: 60,
      })
    ).toBe('Rate limit exceeded: 121/120 requests');
  });

  it('prefers `detail` when a body somehow carries both', () => {
    expect(errorBodyText({ detail: 'from detail', message: 'from message' })).toBe(
      'from detail'
    );
  });

  it('returns nothing for a 422 array of field errors', () => {
    // The case that made this a function. `detail` here is structured data, and
    // callers that used it as a message rendered "[object Object]". Callers now
    // fall through to their own operation-specific fallback, and the array stays
    // readable on the parsed body for whoever wants the field errors.
    const body = {
      detail: [{ loc: ['body', 'title'], msg: 'field required', type: 'value_error' }],
    };
    expect(errorBodyText(body)).toBeUndefined();
  });

  it('returns nothing rather than an empty string', () => {
    // An empty string is falsy, so an inline `||` chain would have skipped past
    // it anyway — but a *returned* '' would defeat a caller's `|| fallback`
    // only if they used `??`. Not returning it at all removes the question.
    expect(errorBodyText({ detail: '' })).toBeUndefined();
    expect(errorBodyText({ detail: '', message: '' })).toBeUndefined();
  });

  it('returns nothing for bodies that carry no text at all', () => {
    expect(errorBodyText({})).toBeUndefined();
    expect(errorBodyText({ error: 'service_unavailable' })).toBeUndefined();
    expect(errorBodyText(null)).toBeUndefined();
    expect(errorBodyText(undefined)).toBeUndefined();
    expect(errorBodyText('a bare string')).toBeUndefined();
    expect(errorBodyText(42)).toBeUndefined();
  });

  it('ignores non-string `detail` / `message` values', () => {
    expect(errorBodyText({ detail: { nested: 'object' } })).toBeUndefined();
    expect(errorBodyText({ message: 12345 })).toBeUndefined();
  });
});

describe('createHttpErrorFromResponse — the shared raw-fetch path', () => {
  it('surfaces the protection middleware`s `message` on a 429', async () => {
    // The defect: `heartbeatSession` and the auth / case / knowledge / session
    // services all throw through here, and a 429 body has no `detail`, so every
    // one of them degraded to "HTTP 429: Too Many Requests".
    const error = await createHttpErrorFromResponse(
      fakeResponse(
        429,
        {
          error: 'rate_limit_exceeded',
          message: 'Rate limit exceeded: per_session_read (121/120)',
          retry_after: 60,
        },
        { statusText: 'Too Many Requests' }
      )
    );

    expect(error.message).toBe('Rate limit exceeded: per_session_read (121/120)');
    expect(error.detail).toBe('Rate limit exceeded: per_session_read (121/120)');
    expect(error.statusCode).toBe(429);
    expect(error.getUserMessage()).toBe('Rate limit exceeded: per_session_read (121/120)');
  });

  it('surfaces `message` on the deduplication 409 too', async () => {
    const error = await createHttpErrorFromResponse(
      fakeResponse(409, { error: 'duplicate_request', message: 'Duplicate request detected' })
    );
    expect(error.message).toBe('Duplicate request detected');
  });

  it('still prefers FastAPI `detail`', async () => {
    const error = await createHttpErrorFromResponse(
      fakeResponse(404, { detail: 'Session not found' })
    );
    expect(error.message).toBe('Session not found');
    expect(error.detail).toBe('Session not found');
  });

  it('does not stringify a 422 field-error array into the message', async () => {
    const detail = [{ loc: ['body', 'title'], msg: 'field required', type: 'value_error' }];
    const error = await createHttpErrorFromResponse(
      fakeResponse(422, { detail }, { statusText: 'Unprocessable Entity' })
    );

    expect(error.message).not.toContain('[object Object]');
    expect(error.message).toBe('HTTP 422: Unprocessable Entity');
    // Not lost — just not treated as a message.
    expect((error.apiError as any).detail).toEqual(detail);
  });

  it('falls back to status text when the body is not JSON', async () => {
    const error = await createHttpErrorFromResponse(
      fakeResponse(502, undefined, { statusText: 'Bad Gateway' })
    );
    expect(error.message).toBe('Bad Gateway');
  });

  it('still snapshots the signal headers', async () => {
    const error = await createHttpErrorFromResponse(
      fakeResponse(409, { message: 'stale' }, { headers: { 'x-error-code': 'VERSION_CONFLICT' } })
    );
    expect(error.headers?.['x-error-code']).toBe('VERSION_CONFLICT');
  });
});

describe('no call site reads `detail` as the message on its own', () => {
  // The review that found this defect named two call sites. There were twelve —
  // each having independently written `errorData.detail || 'Failed to …'`. Fixing
  // the named two would have left ten to be rediscovered, so this asserts the
  // *shape* is gone rather than that those two are fixed.
  //
  // The pattern is `.detail` used directly as the left side of a fallback. It
  // does not match `detail?.toLowerCase().includes(…) ||`, which is a semantic
  // test of FastAPI's own field (a 401 never comes from the protection
  // middleware), nor the classifier's 422 array handling.
  const DETAIL_FALLBACK = /\.detail\s*\|\|/;

  /** Every non-test source file under src/. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'test' && entry !== 'node_modules') sourceFiles(path, out);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(path);
      }
    }
    return out;
  }

  // `HttpError.getUserMessage()` reads its *own* already-extracted `detail`
  // field, which is a string by construction — not a raw body.
  const ALLOWED = new Set(['src/lib/errors/http-error.ts']);

  it('finds no `.detail ||` fallback chain outside the allowed files', () => {
    const files = sourceFiles('src');
    expect(files.length).toBeGreaterThan(50); // the scan actually resolved src/

    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file.split(/[\\/]/).join('/'))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Skip comment lines — prose describing the defect is not the defect.
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
          return;
        }
        if (DETAIL_FALLBACK.test(line)) offenders.push(`${file}:${i + 1}: ${trimmed}`);
      });
    }

    expect(offenders, [
      'These read a body`s `detail` as the message with a fallback, so a 429 or',
      '409 from the protection middleware — which sends `message` and no',
      '`detail` — will report the fallback instead of what the server said.',
      'Use `errorBodyText(body) || <your fallback>` instead:',
      ...offenders,
    ].join('\n')).toEqual([]);
  });

  it('the guard can actually fail', () => {
    // The scan above passes trivially if the regex or the file walk is broken,
    // and a source-scanning test is exactly the kind that rots into a no-op.
    // Prove both halves on a known-bad line and a known-good one.
    expect(DETAIL_FALLBACK.test("throw new Error(errorData.detail || 'Failed')")).toBe(true);
    expect(DETAIL_FALLBACK.test('const t = errorBodyText(errorData) || fallback')).toBe(false);
    expect(DETAIL_FALLBACK.test("if (errorData.detail?.toLowerCase().includes('x') ||")).toBe(
      false
    );
    expect(sourceFiles('src').some(f => f.endsWith('error-body.ts'))).toBe(true);
  });
});
