/**
 * Reading the human-readable text out of a backend error body.
 *
 * The API answers errors in two shapes and always has:
 *
 * - **`detail`** — every FastAPI handler. `HTTPException`, the validation
 *   handlers, the idempotency middleware's 400.
 * - **`message`** — `ProtectionErrorResponse`, which has no `detail` field at
 *   all. This is the shape of every 429 from rate limiting and the 409/503
 *   from deduplication.
 *
 * Reading only `detail` is what made a rate-limited request report a generic
 * fallback instead of what the server said (fm#994). The defect was not in one
 * place: thirteen call sites had each written their own `errorData.detail || …`
 * chain, so fixing the two that were noticed would have left eleven to be
 * rediscovered. They now all read through here, and
 * `error-body.test.ts` fails if a new `.detail ||` chain appears.
 */

/**
 * The message a backend error body carries, or `undefined` if it carries none.
 *
 * Returns a **string or nothing**. A 422 puts an array of per-field validation
 * errors in `detail`; that is structured data, not a message, and callers that
 * used it as one rendered `"[object Object]"`. Field errors are read from the
 * body itself by `ErrorClassifier.extractFieldErrors`, which is the code that
 * knows their shape.
 *
 * Callers supply their own fallback for the `undefined` case, because only the
 * caller knows which operation failed:
 *
 * ```typescript
 * throw new Error(errorBodyText(errorData) || `Failed to get case: ${response.status}`);
 * ```
 */
export function errorBodyText(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const data = body as Record<string, unknown>;

  // `detail` first: when a body carries both, it is the FastAPI-native one and
  // the more specific.
  if (typeof data.detail === 'string' && data.detail.length > 0) {
    return data.detail;
  }
  if (typeof data.message === 'string' && data.message.length > 0) {
    return data.message;
  }

  return undefined;
}
