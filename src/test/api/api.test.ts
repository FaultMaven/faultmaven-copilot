import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  createSession, 
  processQuery, 
  uploadData, 
  heartbeatSession,
  ResponseType,
  AgentResponse,
  UploadedData
} from '../../lib/api';

// Mock the config module
vi.mock('../../config', () => ({
  default: {
    apiUrl: 'https://api.faultmaven.ai'
  }
}));

describe('API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates a session successfully', async () => {
      const mockResponse = {
        session_id: 'test-session-123',
        created_at: '2024-01-01T00:00:00Z',
        status: 'active'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await createSession();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('creates a session with metadata', async () => {
      const mockResponse = {
        session_id: 'test-session-123',
        created_at: '2024-01-01T00:00:00Z',
        status: 'active'
      };

      const metadata = { user_id: 'user-123', environment: 'production' };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await createSession(metadata);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ metadata })
        }
      );
    });

    it('throws error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal server error' })
      });

      await expect(createSession()).rejects.toThrow('Internal server error');
    });
  });

  describe('processQuery', () => {
    it('processes a query successfully with new response type', async () => {
      const mockRequest = {
        session_id: 'test-session-123',
        query: 'Why is my service failing?',
        priority: 'normal' as const,
        context: {
          page_url: 'https://example.com',
          browser_info: 'test-browser'
        }
      };

      const mockResponse: AgentResponse = {
        response_type: ResponseType.ANSWER,
        content: 'Your service is failing because...',
        session_id: 'test-session-123',
        confidence_score: 0.85,
        sources: [
          {
            type: 'log_analysis',
            content: 'Error logs indicate connection timeout',
            confidence: 0.9
          }
        ]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await processQuery(mockRequest);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/agent/query',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mockRequest)
        }
      );
      expect(result).toEqual(mockResponse);
      expect(result.response_type).toBe(ResponseType.ANSWER);
    });

    it('processes a query with plan proposal response', async () => {
      const mockRequest = {
        session_id: 'test-session-123',
        query: 'How do I fix this issue?',
        priority: 'high' as const,
        context: {}
      };

      const mockResponse: AgentResponse = {
        response_type: ResponseType.PLAN_PROPOSAL,
        content: 'Here is a step-by-step plan to resolve the issue',
        session_id: 'test-session-123',
        plan: {
          step_number: 1,
          action: 'Check system logs',
          description: 'Review recent error logs for clues',
          estimated_time: '5 minutes'
        },
        confidence_score: 0.9
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await processQuery(mockRequest);

      expect(result.response_type).toBe(ResponseType.PLAN_PROPOSAL);
      expect(result.plan).toBeDefined();
      expect(result.plan?.step_number).toBe(1);
    });

    it('throws error on query failure', async () => {
      const mockRequest = {
        session_id: 'test-session-123',
        query: 'test query',
        priority: 'normal' as const,
        context: {}
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Invalid query' })
      });

      await expect(processQuery(mockRequest)).rejects.toThrow('Invalid query');
    });
  });

  describe('uploadData', () => {
    it('uploads file data successfully with new endpoint', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const mockResponse: UploadedData = {
        data_id: 'data-123',
        session_id: 'session-123',
        data_type: 'log_file',
        content: 'test content',
        file_name: 'test.txt',
        file_size: 12,
        uploaded_at: '2024-01-01T00:00:00Z',
        processing_status: 'completed'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await uploadData('session-123', mockFile, 'file');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/data/upload',
        {
          method: 'POST',
          body: expect.any(FormData)
        }
      );

      // Verify FormData contents
      const formData = (fetch as any).mock.calls[0][1].body;
      expect(formData.get('session_id')).toBe('session-123');
      expect(formData.get('file')).toBe(mockFile);

      expect(result).toEqual(mockResponse);
      expect(result.data_type).toBe('log_file');
    });

    it('uploads text data successfully', async () => {
      const mockResponse: UploadedData = {
        data_id: 'data-123',
        session_id: 'session-123',
        data_type: 'documentation',
        content: 'test log content',
        uploaded_at: '2024-01-01T00:00:00Z',
        processing_status: 'completed'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await uploadData('session-123', 'test log content', 'text');

      const formData = (fetch as any).mock.calls[0][1].body;
      expect(formData.get('session_id')).toBe('session-123');
      expect(formData.get('file')).toBeDefined();
    });

    it('uploads page content successfully', async () => {
      const mockResponse: UploadedData = {
        data_id: 'data-123',
        session_id: 'session-123',
        data_type: 'documentation',
        content: 'page content',
        uploaded_at: '2024-01-01T00:00:00Z',
        processing_status: 'completed'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await uploadData('session-123', 'page content', 'page');

      const formData = (fetch as any).mock.calls[0][1].body;
      expect(formData.get('session_id')).toBe('session-123');
      expect(formData.get('file')).toBeDefined();
    });
  });

  describe('heartbeatSession', () => {
    it('sends heartbeat successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true
      });

      await heartbeatSession('session-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/session-123/heartbeat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    });

    it('throws error on heartbeat failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Session not found' })
      });

      await expect(heartbeatSession('invalid-session')).rejects.toThrow('Session not found');
    });
  });

  describe('Response Types', () => {
    it('supports all response types', () => {
      expect(ResponseType.ANSWER).toBe('ANSWER');
      expect(ResponseType.PLAN_PROPOSAL).toBe('PLAN_PROPOSAL');
      expect(ResponseType.CLARIFICATION_REQUEST).toBe('CLARIFICATION_REQUEST');
      expect(ResponseType.CONFIRMATION_REQUEST).toBe('CONFIRMATION_REQUEST');
      expect(ResponseType.SOLUTION_READY).toBe('SOLUTION_READY');
      expect(ResponseType.NEEDS_MORE_DATA).toBe('NEEDS_MORE_DATA');
      expect(ResponseType.ESCALATION_REQUIRED).toBe('ESCALATION_REQUIRED');
    });
  });
});
