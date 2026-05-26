/**
 * Case Service - API calls for case UI data
 */

import type { CaseUIResponse } from '../../types/case';
import { getApiUrl } from '../../config';
import { getAuthHeaders } from './fetch-utils';

/**
 * Fetch UI-optimized case data
 *
 * Pass `signal` (e.g. from TanStack Query's queryFn context) to allow the
 * fetch to be aborted when the consumer switches cases mid-flight.
 */
async function getCaseUI(
  caseId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<CaseUIResponse> {
  const headers = await getAuthHeaders();
  const apiUrl = await getApiUrl();

  const response = await fetch(`${apiUrl}/api/v1/cases/${caseId}/ui`, {
    method: 'GET',
    headers,
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch case UI data' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export const caseApi = {
  getCaseUI,
};
