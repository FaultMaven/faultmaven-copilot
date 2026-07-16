/**
 * Files Service - API calls for uploaded files data
 */

import type { UploadedFileMetadata, UploadedFileDetailsResponse } from '../../types/case';
import { getApiUrl } from '../../config';
import { authenticatedFetchWithRetry } from './client';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('FilesService');

// These reads go through authenticatedFetchWithRetry (not a raw `fetch`) so they
// get the request timeout, 401 session-refresh-and-retry, and status-enriched
// errors. authenticatedFetchWithRetry throws on any non-OK response, so the
// `response` below is always OK.

/**
 * Fetch uploaded files list for a case
 * GET /api/v1/cases/{case_id}/uploaded-files
 */
async function getUploadedFiles(caseId: string): Promise<UploadedFileMetadata[]> {
  const apiUrl = await getApiUrl();

  const response = await authenticatedFetchWithRetry(`${apiUrl}/api/v1/cases/${caseId}/uploaded-files`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = await response.json();
  log.debug('Fetched uploaded files', { caseId, fileCount: data.files?.length ?? 0 });
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
  const apiUrl = await getApiUrl();

  const response = await authenticatedFetchWithRetry(
    `${apiUrl}/api/v1/cases/${caseId}/uploaded-files/${fileId}`,
    {
      method: 'GET',
      credentials: 'include',
    }
  );

  const data = await response.json();
  log.debug('Fetched file details', { caseId, fileId });
  return data;
}

export const filesApi = {
  getUploadedFiles,
  getUploadedFileDetails,
};
