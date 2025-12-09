import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSession,
  heartbeatSession,
  submitQueryToCase,
  ResponseType,
  AgentResponse,
  UploadedData
} from '../../lib/api';

// Mock the config module
vi.mock('../../config', () => ({
  __esModule: true,
  default: {
    session: {
      timeoutMinutes: 180,
      timeoutMs: 180 * 60 * 1000
    },
    inputLimits: {
      dataModeLinesThreshold: 100,
      maxQueryLength: 200000,
      maxFileSize: 10 * 1024 * 1024
    }
  },
  getApiUrl: vi.fn().mockResolvedValue('https://api.faultmaven.ai')
}));

// Mock browser for tests that use uploadData (which now requires auth)
const { mockBrowserStorage } = vi.hoisted(() => {
  const storage = {
    local: {
      get: vi.fn().mockResolvedValue({}), // No auth by default
      set: vi.fn(),
      remove: vi.fn()
    }
  };
  return { mockBrowserStorage: storage };
});

vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockBrowserStorage
  }
}));

(global as any).browser = {
  storage: mockBrowserStorage
};

describe('API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset browser storage mock
    mockBrowserStorage.local.get.mockResolvedValue({});
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
        'https://api.faultmaven.ai/api/v1/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('client_id')
        })
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
        'https://api.faultmaven.ai/api/v1/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('metadata')
        })
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

  // Removed legacy processQuery tests; case-centric query flow is tested via UI integration.

  // REMOVED: Legacy uploadData() tests
  // Function removed in favor of uploadDataToCase() (case-centric v2.0 architecture)
  // Tests for uploadDataToCase() should be added if needed for integration testing

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
          credentials: 'include'
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

  describe('submitQueryToCase', () => {
    it('detects backend contract violation - OpenAI format', async () => {
      const openAIResponse = {
        choices: [{ message: { content: 'Hello from OpenAI format' } }],
        model: 'gpt-3.5-turbo'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map(),
        json: () => Promise.resolve(openAIResponse)
      });

      await expect(submitQueryToCase('case-123', {
        session_id: 'session-123',
        query: 'test query',
        priority: 'normal'
      })).rejects.toThrow('Backend API contract violation: AgentResponse missing required fields');
    });

    it('accepts valid AgentResponse format', async () => {
      const agentResponse = {
        response_type: 'ANSWER',
        content: 'Hello from AgentResponse format',
        session_id: 'session-123'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map(),
        json: () => Promise.resolve(agentResponse)
      });

      const result = await submitQueryToCase('case-123', {
        session_id: 'session-123',
        query: 'test query',
        priority: 'normal'
      });

      expect(result).toEqual(agentResponse);
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
