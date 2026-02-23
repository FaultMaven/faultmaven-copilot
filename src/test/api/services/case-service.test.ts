import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as caseService from '../../../lib/api/services/case-service';
import * as client from '../../../lib/api/client';

// Mock client
vi.mock('../../../lib/api/client', () => ({
  authenticatedFetchWithRetry: vi.fn(),
  authenticatedFetch: vi.fn(),
  // Use actual prepareBody implementation - it's a pure function
  prepareBody: (body: unknown) => {
    if (body === undefined || body === null) return undefined;
    return JSON.stringify(body, (_key, value) => value === undefined ? null : value);
  }
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
  const mockResponse = (data: any, ok = true, status?: number) => ({
    ok,
    status: status ?? (ok ? 200 : 500),
    json: vi.fn().mockResolvedValue(data),
    headers: { get: vi.fn() },
    clone: () => ({ json: vi.fn().mockResolvedValue(data) })
  });

  describe('createCase', () => {
    it('should create a case successfully', async () => {
      // API returns CaseSummary directly at root level per OpenAPI spec
      const responseData = {
        case_id: 'case-123',
        title: 'New Case',
        status: 'inquiry',
        created_at: '2024-01-01T00:00:00Z',
        user_id: 'user-1'
      };
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
      expect(result.case_id).toEqual('case-123');
      expect(result.title).toEqual('New Case');
      expect(result.owner_id).toEqual('user-1'); // Maps user_id -> owner_id
    });
  });

  describe('getUserCases', () => {
    it('should fetch user cases', async () => {
      const mockCases = [
        { case_id: '1', title: 'Case 1', status: 'inquiry', created_at: '2024-01-01', user_id: 'user-1' },
        { case_id: '2', title: 'Case 2', status: 'investigating', created_at: '2024-01-02', user_id: 'user-2' }
      ];
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse({ cases: mockCases }));

      const result = await caseService.getUserCases();

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/cases'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.length).toEqual(2);
      expect(result[0].case_id).toEqual('1');
      expect(result[0].owner_id).toEqual('user-1'); // Maps user_id -> owner_id
      expect(result[1].case_id).toEqual('2');
      expect(result[1].owner_id).toEqual('user-2');
    });
  });

  describe('submitTurn', () => {
    it('should submit a query-only turn', async () => {
      const turnResponseData = {
        agent_response: 'AI Response',
        turn_number: 1,
        milestones_completed: [],
        case_status: 'inquiry',
        progress_made: false,
        is_stuck: false,
        attachments_processed: []
      };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(turnResponseData));

      const caseId = 'case-123';
      const result = await caseService.submitTurn(caseId, { query: 'test query' });

      expect(client.authenticatedFetchWithRetry).toHaveBeenCalledWith(
        `https://api.test/api/v1/cases/${caseId}/turns`,
        expect.objectContaining({
          method: 'POST',
          credentials: 'include'
        })
      );

      // Verify FormData was sent (body is FormData instance)
      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('query')).toBe('test query');

      // Verify response
      expect(result.agent_response).toBe('AI Response');
      expect(result.turn_number).toBe(1);
      expect(result.attachments_processed).toEqual([]);
    });

    it('should submit a turn with pasted content', async () => {
      const turnResponseData = {
        agent_response: 'Analyzed your logs',
        turn_number: 2,
        milestones_completed: ['initial_evidence'],
        case_status: 'investigating',
        progress_made: true,
        is_stuck: false,
        attachments_processed: [{
          evidence_id: 'ev_abc123',
          filename: 'pasted-content-20260222T120000.txt',
          data_type: 'logs_and_errors',
          file_size: 1024,
          processing_status: 'completed'
        }]
      };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(turnResponseData));

      const result = await caseService.submitTurn('case-123', {
        pastedContent: 'ERROR: Connection refused at port 5432'
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body;
      expect(body.get('pasted_content')).toBe('ERROR: Connection refused at port 5432');
      expect(result.attachments_processed).toHaveLength(1);
      expect(result.attachments_processed[0].evidence_id).toBe('ev_abc123');
    });

    it('should submit a turn with query and intent', async () => {
      const turnResponseData = {
        agent_response: 'Case resolved',
        turn_number: 5,
        milestones_completed: [],
        case_status: 'resolved',
        progress_made: true,
        is_stuck: false,
        attachments_processed: []
      };
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(mockResponse(turnResponseData));

      await caseService.submitTurn('case-123', {
        query: 'Resolve this case',
        intentType: 'status_transition',
        intentData: { from_status: 'investigating', to_status: 'resolved', user_confirmed: true }
      });

      const callArgs = (client.authenticatedFetchWithRetry as any).mock.calls[0];
      const body = callArgs[1].body;
      expect(body.get('query')).toBe('Resolve this case');
      expect(body.get('intent_type')).toBe('status_transition');
      expect(JSON.parse(body.get('intent_data'))).toEqual({
        from_status: 'investigating',
        to_status: 'resolved',
        user_confirmed: true
      });
    });

    it('should throw error when no query, files, or pasted content provided', async () => {
      await expect(
        caseService.submitTurn('case-123', {})
      ).rejects.toThrow('Turn must include at least one of: query, files, or pastedContent');
    });

    it('should throw error on 422 validation error', async () => {
      const errorResponse = mockResponse(
        { detail: 'Missing required field' },
        false,
        422
      );
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(errorResponse);

      await expect(
        caseService.submitTurn('case-123', { query: 'test' })
      ).rejects.toThrow('422 Unprocessable Entity');
    });

    it('should throw error on 404 case not found', async () => {
      const errorResponse = mockResponse(
        { detail: 'Case not found' },
        false,
        404
      );
      (client.authenticatedFetchWithRetry as any).mockResolvedValue(errorResponse);

      await expect(
        caseService.submitTurn('case-123', { query: 'test' })
      ).rejects.toThrow('Case not found: Please refresh and try again');
    });
  });

  describe('Utility Functions', () => {
    it('should return valid transitions', () => {
      const transitions = caseService.getValidTransitions('inquiry');
      expect(transitions).toEqual(['investigating', 'closed']);
    });

    it('should get correct status change message', () => {
      const msg = caseService.getStatusChangeMessage('inquiry', 'investigating');
      expect(msg).toBe('I want to start a formal investigation to find the root cause.');
    });
  });
});
