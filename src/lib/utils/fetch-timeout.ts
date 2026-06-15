/**
 * fetch() wrapped with an abortable timeout.
 *
 * Bounds hung connections — a network stall with no RST/FIN would otherwise
 * leave the promise pending forever. That is especially damaging on the
 * token-refresh and session-creation paths, where a hang blocks `getAuthHeaders`
 * and therefore every downstream request, with no recovery.
 *
 * - On timeout, rejects with a `TimeoutError` (name set for the error
 *   classifier / recovery layer).
 * - A caller-provided `init.signal` is linked, so external cancellation
 *   (e.g. component unmount) still aborts the request.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeoutError: Error & { name: string } = new Error(
        `Request timed out after ${timeoutMs}ms`
      );
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
