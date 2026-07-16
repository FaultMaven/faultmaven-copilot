import { describe, it, expect, vi, beforeEach } from 'vitest';

// These services previously used a raw `fetch()`, bypassing the request timeout,
// 401 session-refresh, and status enrichment. They must now route through
// authenticatedFetchWithRetry.
const { authenticatedFetchWithRetry } = vi.hoisted(() => ({
  authenticatedFetchWithRetry: vi.fn()
}));

vi.mock('../../../lib/api/client', () => ({ authenticatedFetchWithRetry }));
vi.mock('../../../config', () => ({ getApiUrl: vi.fn().mockResolvedValue('https://api.test') }));
vi.mock('~/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { caseApi } from '../../../lib/api/case-service';
import { filesApi } from '../../../lib/api/files-service';

const okJson = (body: any) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(body) });

describe('raw-fetch bypass removed — services route through authenticatedFetchWithRetry', () => {
  beforeEach(() => {
    authenticatedFetchWithRetry.mockReset();
    // Ensure the real global fetch is NOT used by these services.
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(() => {
      throw new Error('raw fetch must not be called');
    });
  });

  it('getCaseUI uses authenticatedFetchWithRetry and forwards the abort signal', async () => {
    authenticatedFetchWithRetry.mockResolvedValue(okJson({ case_id: 'c1', state: 'inquiry' }));
    const signal = new AbortController().signal;

    const result = await caseApi.getCaseUI('c1', 'sess', signal);

    expect(authenticatedFetchWithRetry).toHaveBeenCalledWith(
      'https://api.test/api/v1/cases/c1/ui',
      expect.objectContaining({ method: 'GET', credentials: 'include', signal })
    );
    expect(result).toEqual({ case_id: 'c1', state: 'inquiry' });
  });

  it('getUploadedFiles uses authenticatedFetchWithRetry', async () => {
    authenticatedFetchWithRetry.mockResolvedValue(okJson({ files: [{ file_id: 'f1' }] }));

    const files = await filesApi.getUploadedFiles('c1');

    expect(authenticatedFetchWithRetry).toHaveBeenCalledWith(
      'https://api.test/api/v1/cases/c1/uploaded-files',
      expect.objectContaining({ method: 'GET' })
    );
    expect(files).toEqual([{ file_id: 'f1' }]);
  });

  it('getUploadedFileDetails uses authenticatedFetchWithRetry', async () => {
    authenticatedFetchWithRetry.mockResolvedValue(okJson({ file_id: 'f1', evidence: [] }));

    const details = await filesApi.getUploadedFileDetails('c1', 'f1');

    expect(authenticatedFetchWithRetry).toHaveBeenCalledWith(
      'https://api.test/api/v1/cases/c1/uploaded-files/f1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(details).toEqual({ file_id: 'f1', evidence: [] });
  });
});
