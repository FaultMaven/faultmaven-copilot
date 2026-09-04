import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSession,
  heartbeatSession,
  submitTurn,
  ResponseType,
  TurnResponse,
} from '../../lib/api';

// Build-time constants only; the endpoint is the host's answer, below.
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
  }
}));

// Storage for the paths that need it (the client id, and the auth state these
// tests deliberately leave empty).
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

import { setApiTransport } from '../../lib/api/transport';
import { setHostStore } from '../../lib/host-store';

describe('API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset browser storage mock
    mockBrowserStorage.local.get.mockResolvedValue({});

    // The base URL every request below is asserted against is the HOST's
    // answer, not a module the API layer reads. Bound to this file's own
    // storage mock so the session id and the (absent) credential come from the
    // same place the assertions stage them.
    setHostStore({
      get: (keys) => mockBrowserStorage.local.get(keys),
      set: (items) => mockBrowserStorage.local.set(items),
      remove: (keys) => mockBrowserStorage.local.remove(keys),
      subscribe: () => () => {},
    });
    setApiTransport({
      baseUrl: async () => 'https://api.faultmaven.ai',
      accessToken: async () => {
        const stored = await mockBrowserStorage.local.get(['authState']);
        const token = (stored as any)?.authState?.access_token;
        if (!token) throw new Error('no credential staged');
        return token;
      },
      sessionId: async () => {
        const stored = await mockBrowserStorage.local.get(['sessionId']);
        return (stored as any)?.sessionId ?? null;
      },
      clearSession: async () => {},
      onUnauthorized: () => {},
    });
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

  // REMOVED: Legacy uploadData() and uploadDataToCase() tests
  // Both replaced by unified submitTurn() endpoint (v4.1 unified ingestion pipeline)

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
          credentials: 'include',
          // authenticatedFetch wraps the request with an abortable timeout.
          signal: expect.any(AbortSignal)
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

  describe('submitTurn', () => {
    it('accepts valid TurnResponse format', async () => {
      const turnResponse = {
        agent_response: 'Hello from TurnResponse format',
        turn_number: 1,
        milestones_completed: [],
        case_state: 'inquiry',
        progress_made: false,
        is_stuck: false,
        attachments_processed: []
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        json: () => Promise.resolve(turnResponse)
      });

      const result = await submitTurn('case-123', {
        query: 'test query'
      });

      expect(result.agent_response).toBe('Hello from TurnResponse format');
      expect(result.turn_number).toBe(1);
    });

    it('rejects empty turn', async () => {
      await expect(submitTurn('case-123', {})).rejects.toThrow(
        'Turn must include at least one of: query, files, or pastedContent'
      );
    });

    it('surfaces 409 as CaseVersionConflictError via the classifier', async () => {
      // Backend OCC returns 409 when a status change (or any versioned
      // case write) lands while the turn is in flight. The fetch
      // client (authenticatedFetchWithRetry) enriches non-OK responses
      // with `status` so the ErrorClassifier can route them. We verify
      // the end-to-end: 409 fetch → caught error → classifier output =
      // CaseVersionConflictError with manual_retry recovery.
      const { CaseVersionConflictError } = await import('../../lib/errors/types');
      const { ErrorClassifier } = await import('../../lib/errors/classifier');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Map(),
        json: () => Promise.resolve({
          detail:
            'Case state changed while processing this turn. ' +
            'Reload the case and resubmit if still applicable.',
        }),
      });

      let caught: unknown;
      try {
        await submitTurn('case-123', { query: 'test query' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as any).status).toBe(409);

      // ErrorClassifier upgrades the 409 to CaseVersionConflictError so
      // the hook layer can route to the soft-retry path (manual_retry,
      // no auto-retry — replaying would just re-hit the same conflict).
      const classified = ErrorClassifier.classify(caught);
      expect(classified).toBeInstanceOf(CaseVersionConflictError);
      expect(classified.recovery).toBe('manual_retry');
      expect(classified.userMessage).toMatch(/case state changed/i);
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
