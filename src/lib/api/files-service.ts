/**
 * Files Service - API calls for uploaded files data
 */

import type { UploadedFileMetadata, UploadedFileDetailsResponse } from '../../types/case';
import { getApiUrl } from '../../config';
import { getAuthHeaders } from './fetch-utils';

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
