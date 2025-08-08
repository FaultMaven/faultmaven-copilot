import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSession, processQuery, uploadData, heartbeatSession } from '../../lib/api';

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
        created_at: '2024-01-01T00:00:00Z'
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
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('creates a session with user_id parameter', async () => {
      const mockResponse = {
        session_id: 'test-session-123',
        created_at: '2024-01-01T00:00:00Z'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await createSession('user-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/?user_id=user-123',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
    it('processes a query successfully', async () => {
      const mockRequest = {
        session_id: 'test-session-123',
        query: 'Why is my service failing?',
        priority: 'normal' as const,
        context: {
          page_url: 'https://example.com',
          browser_info: 'test-browser'
        }
      };

      const mockResponse = {
        response: 'Your service is failing because...',
        findings: ['Finding 1', 'Finding 2'],
        recommendations: ['Recommendation 1'],
        confidence_score: 0.85,
        session_id: 'test-session-123'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await processQuery(mockRequest);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/query/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mockRequest)
        }
      );
      expect(result).toEqual(mockResponse);
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
    it('uploads file data successfully', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const mockResponse = {
        data_id: 'data-123',
        filename: 'test.txt',
        insights: 'Initial analysis...',
        status: 'success'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await uploadData('session-123', mockFile, 'file');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/data/',
        {
          method: 'POST',
          body: expect.any(FormData)
        }
      );

      // Verify FormData contents
      const formData = (fetch as any).mock.calls[0][1].body;
      expect(formData.get('session_id')).toBe('session-123');
      expect(formData.get('data_type')).toBe('file');
      expect(formData.get('file')).toBe(mockFile);

      expect(result).toEqual(mockResponse);
    });

    it('uploads text data successfully', async () => {
      const mockResponse = {
        data_id: 'data-123',
        status: 'success'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await uploadData('session-123', 'test log content', 'text');

      const formData = (fetch as any).mock.calls[0][1].body;
      expect(formData.get('session_id')).toBe('session-123');
      expect(formData.get('data_type')).toBe('text');
      expect(formData.get('content')).toBe('test log content');
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
        json: () => Promise.resolve({ message: 'Session not found' })
      });

      await expect(heartbeatSession('invalid-session')).rejects.toThrow('Session not found');
    });
  });
});
