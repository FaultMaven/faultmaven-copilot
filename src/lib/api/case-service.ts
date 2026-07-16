/**
 * Case Service - API calls for case UI data
 */

import type { CaseUIResponse } from '../../types/case';
import { getApiUrl } from '../../config';
import { authenticatedFetchWithRetry } from './client';

/**
 * Fetch UI-optimized case data
 *
 * Routed through `authenticatedFetchWithRetry` so it gets the request timeout,
 * 401 session-refresh-and-retry, and status-enriched errors that a raw `fetch`
 * bypassed (a bare `fetch` here left the classifier unable to route failures and
 * could hang forever on a stalled connection).
 *
 * Pass `signal` (e.g. from TanStack Query's queryFn context) to allow the
 * fetch to be aborted when the consumer switches cases mid-flight.
 */
async function getCaseUI(
  caseId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<CaseUIResponse> {
  const apiUrl = await getApiUrl();

  // authenticatedFetchWithRetry throws a status-enriched error on any non-OK
  // response, so `response` here is always OK.
  const response = await authenticatedFetchWithRetry(`${apiUrl}/api/v1/cases/${caseId}/ui`, {
    method: 'GET',
    credentials: 'include',
    signal,
  });

  return response.json();
}

export const caseApi = {
  getCaseUI,
};
