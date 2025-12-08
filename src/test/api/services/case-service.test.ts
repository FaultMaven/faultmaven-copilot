import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as caseService from '../../../lib/api/services/case-service';
import * as client from '../../../lib/api/client';

// Mock client
vi.mock('../../../lib/api/client', () => ({
  authenticatedFetchWithRetry: vi.fn(),
  authenticatedFetch: vi.fn()
}));

// Mock config
vi.mock('../../../config', () => ({
  getApiUrl: vi.fn().mockReturnValue('https://api.test')
}));

describe('Case Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a mock Response
  const mockResponse = (data: any, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(data),
    headers: { get: vi.fn() },
    clone: () => ({ json: vi.fn().mockResolvedValue(data) })
  });

  describe('createCase', () => {
    it('should create a case successfully', async () => {
      const responseData = { case: { case_id: 'case-123', title: 'New Case' } };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const request = {
        title: 'New Case',
        priority: 'medium' as const,
        metadata: { created_via: 'test' }
      };

      const result = await caseService.createCase(request);

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        'https://api.test/api/v1/cases',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(request)
        })
      );
      expect(result).toEqual(responseData.case);
    });
  });

  describe('getUserCases', () => {
    it('should fetch user cases', async () => {
      const mockCases = [{ case_id: '1' }, { case_id: '2' }];
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse({ cases: mockCases }));

      const result = await caseService.getUserCases();

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/cases'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual(mockCases);
    });
  });

  describe('submitQueryToCase', () => {
    it('should submit query to case', async () => {
      const responseData = { 
        content: 'AI Response',
        response_type: 'ANSWER',
        session_id: 'sess-1'
      };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(responseData));

      const caseId = 'case-123';
      const queryRequest = { query: 'test', session_id: 'sess-1' };

      const result = await caseService.submitQueryToCase(caseId, queryRequest);

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        `https://api.test/api/v1/cases/${caseId}/queries`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            message: queryRequest.query,
            attachments: undefined
          })
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('Utility Functions', () => {
    it('should return valid transitions', () => {
      const transitions = caseService.getValidTransitions('consulting');
      expect(transitions).toEqual(['investigating', 'closed']);
    });

    it('should get correct status change message', () => {
      const msg = caseService.getStatusChangeMessage('consulting', 'investigating');
      expect(msg).toBe('I want to start a formal investigation to find the root cause.');
    });
  });
});
