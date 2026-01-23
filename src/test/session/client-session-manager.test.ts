import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ClientSessionManager } from '../../lib/session/client-session-manager';

// Hoist mock browser
const { mockBrowser } = vi.hoisted(() => {
  return {
    mockBrowser: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined)
        }
      },
      runtime: {
        id: 'test-ext-id'
      }
    }
  };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: mockBrowser
}));

// Mock config
vi.mock('../../config', () => ({
  default: {
    apiUrl: 'http://localhost:8090',
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
  getApiUrl: vi.fn().mockResolvedValue('http://localhost:8090')
}));

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: vi.fn(() => 'test-uuid-12345678-1234-5678-9012-123456789012'),
  },
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock fetch for API calls
global.fetch = vi.fn();

// Global stub just in case
vi.stubGlobal('browser', mockBrowser);

describe('ClientSessionManager', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset singleton instance
    (ClientSessionManager as any).instance = undefined;
    
    // Reset mock return values
    mockBrowser.storage.local.get.mockResolvedValue({});
  });


  test('generates and persists client ID', async () => {
    const manager = ClientSessionManager.getInstance();

    const clientId1 = await manager.getOrCreateClientId();
    const clientId2 = await manager.getOrCreateClientId();

    expect(clientId1).toBe(clientId2);
    expect(clientId1).toBe('test-uuid-12345678-1234-5678-9012-123456789012');
    expect(mockBrowser.storage.local.set).toHaveBeenCalledWith({ faultmaven_client_id: clientId1 });
    expect(mockBrowser.storage.local.get).toHaveBeenCalledWith(['faultmaven_client_id']);
  });

  test('uses existing client ID from localStorage', async () => {
    mockBrowser.storage.local.get.mockResolvedValue({ faultmaven_client_id: 'existing-client-id' });

    const manager = ClientSessionManager.getInstance();
    const clientId = await manager.getOrCreateClientId();

    expect(clientId).toBe('existing-client-id');
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  test('clears client ID correctly', async () => {
    const manager = ClientSessionManager.getInstance();

    // First, create a client ID
    await manager.getOrCreateClientId();
    expect(mockBrowser.storage.local.set).toHaveBeenCalled();

    // Then clear it
    await manager.clearClientId();
    expect(mockBrowser.storage.local.remove).toHaveBeenCalledWith(['faultmaven_client_id']);

    // Next call should generate a new ID
    vi.mocked(crypto.randomUUID).mockReturnValue('87654321-4321-5678-9012-123456789012');
    mockBrowser.storage.local.get.mockResolvedValue({}); // Reset for new ID
    const newClientId = await manager.getOrCreateClientId();
    expect(newClientId).toBe('87654321-4321-5678-9012-123456789012');
  });

  test('handles session creation with client_id and timeout', async () => {
    const mockSessionResponse = {
      session_id: 'session-123',
      client_id: 'test-uuid-12345678-1234-5678-9012-123456789012',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      session_type: 'troubleshooting',
      session_resumed: false,
      message: 'Session created successfully'
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSessionResponse),
    } as Response);

    const manager = ClientSessionManager.getInstance();
    const session = await manager.createSession();

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8090/api/v1/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('timeout_minutes'),
      })
    );

    expect(session).toEqual(mockSessionResponse);
  });

  test('handles session resumption', async () => {
    const mockResumedSession = {
      session_id: 'resumed-session-456',
      client_id: 'test-uuid-12345678-1234-5678-9012-123456789012',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      session_type: 'troubleshooting',
      session_resumed: true,
      message: 'Session resumed successfully'
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResumedSession),
    } as Response);

    const manager = ClientSessionManager.getInstance();
    const session = await manager.createSession();

    expect(manager.isSessionResumed(session)).toBe(true);
    expect(session.message).toBe('Session resumed successfully');
  });

  test('handles session expiration and creates fresh session', async () => {
    const manager = ClientSessionManager.getInstance();

    // First call fails with session expired error
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Session expired' }),
    } as Response);

    // Second call succeeds after clearing client ID
    const mockNewSession = {
      session_id: 'new-session-789',
      client_id: '12345678-after-clear-9012-123456789012',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      session_type: 'troubleshooting',
      session_resumed: false,
      message: 'Session created successfully'
    };

    vi.mocked(crypto.randomUUID).mockReturnValue('12345678-after-clear-9012-123456789012');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockNewSession),
    } as Response);

    const session = await manager.createSessionWithRecovery();

    expect(mockBrowser.storage.local.remove).toHaveBeenCalledWith(['faultmaven_client_id']);
    expect(session.session_id).toBe('new-session-789');
    expect(session.session_resumed).toBe(false);
  });

  test('validates session timeout within acceptable range', async () => {
    const manager = ClientSessionManager.getInstance();

    const mockSessionResponse = {
      session_id: 'session-123',
      client_id: 'test-client-id',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      session_type: 'troubleshooting',
      session_resumed: false,
      message: 'Session created successfully'
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSessionResponse),
    } as Response);

    // Test with timeout too low (should clamp to minimum)
    await manager.createSession(undefined, 30);
    let lastCall = vi.mocked(fetch).mock.calls.pop();
    expect(lastCall?.[1]?.body).toContain('"timeout_minutes":60');

    // Test with timeout too high (should clamp to maximum)
    await manager.createSession(undefined, 600);
    lastCall = vi.mocked(fetch).mock.calls.pop();
    expect(lastCall?.[1]?.body).toContain('"timeout_minutes":480');

    // Test with valid timeout (should use as-is)
    await manager.createSession(undefined, 120);
    lastCall = vi.mocked(fetch).mock.calls.pop();
    expect(lastCall?.[1]?.body).toContain('"timeout_minutes":120');
  });

  test('singleton pattern works correctly', () => {
    const manager1 = ClientSessionManager.getInstance();
    const manager2 = ClientSessionManager.getInstance();

    expect(manager1).toBe(manager2);
  });
});
