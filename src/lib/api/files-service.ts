/**
 * Files Service - API calls for uploaded files data
 */

import type { UploadedFileMetadata, UploadedFileDetailsResponse } from '../../types/case';
import { getApiUrl } from '../../config';

/**
 * Gets dual headers for API requests (Authentication + Session)
 * Returns both Authorization and X-Session-Id headers when available
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Get auth token from AuthState
      const result = await browser.storage.local.get(['authState']);
      const authState = result.authState;

      if (authState?.access_token) {
        // Check if token is expired
        if (Date.now() < authState.expires_at) {
          headers['Authorization'] = `Bearer ${authState.access_token}`;
        }
      }

      // Get session ID
      const sessionData = await browser.storage.local.get(['sessionId']);
      if (sessionData.sessionId) {
        headers['X-Session-Id'] = sessionData.sessionId;
      }
    }
  } catch (error) {
    console.warn('[FilesService] Failed to get auth/session headers:', error);
  }

  return headers;
}

/**
 * Fetch uploaded files list for a case
 * GET /api/v1/cases/{case_id}/uploaded-files
 */
async function getUploadedFiles(caseId: string): Promise<UploadedFileMetadata[]> {
  const headers = await getAuthHeaders();
  const apiUrl = await getApiUrl();

  const response = await fetch(`${apiUrl}/api/v1/cases/${caseId}/uploaded-files`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch uploaded files' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log('[FilesService] API response:', data);
  console.log('[FilesService] Extracted files:', data.files);
  return data.files || [];
}

/**
 * Fetch uploaded file details with derived evidence
 * GET /api/v1/cases/{case_id}/uploaded-files/{file_id}
 */
async function getUploadedFileDetails(
  caseId: string,
  fileId: string
): Promise<UploadedFileDetailsResponse> {
  const headers = await getAuthHeaders();
  const apiUrl = await getApiUrl();

  const response = await fetch(
    `${apiUrl}/api/v1/cases/${caseId}/uploaded-files/${fileId}`,
    {
      method: 'GET',
      headers,
      credentials: 'include',
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch file details' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log('[FilesService] File details response:', data);
  return data;
}

export const filesApi = {
  getUploadedFiles,
  getUploadedFileDetails,
};
