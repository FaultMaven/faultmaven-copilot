import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ClientSessionManager } from '../../lib/session/client-session-manager';

// Mock config
vi.mock('../../config', () => ({
  default: {
    apiUrl: 'http://localhost:8000',
    session: {
      timeoutMinutes: 180,
      timeoutMs: 180 * 60 * 1000
    }
  },
  getApiUrl: vi.fn().mockResolvedValue('http://localhost:8000')
}));

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: vi.fn(() => 'test-uuid-12345678-1234-5678-9012-123456789012'),
  },
});

// Mock browser.storage.local
const browserStorageMock = (() => {
  let store: Record<string, any> = {};

  return {
    get: vi.fn((keys: string[]) => {
      const result: Record<string, any> = {};
      for (const key of keys) {
        if (store[key] !== undefined) {
          result[key] = store[key];
        }
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, any>) => {
      Object.assign(store, items);
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string[]) => {
      for (const key of keys) {
        delete store[key];
      }
      return Promise.resolve();
    }),
    clear: () => {
      store = {};
    },
  };
})();

// Mock browser global
(global as any).browser = {
  storage: {
    local: browserStorageMock,
  },
};

// Mock fetch for API calls
global.fetch = vi.fn();

describe('ClientSessionManager', () => {
  beforeEach(() => {
    browserStorageMock.clear();
    vi.clearAllMocks();
    // Reset singleton instance
    (ClientSessionManager as any).instance = undefined;
  });

  test('generates and persists client ID', async () => {
    const manager = ClientSessionManager.getInstance();

    const clientId1 = await manager.getOrCreateClientId();
    const clientId2 = await manager.getOrCreateClientId();

    expect(clientId1).toBe(clientId2);
    expect(clientId1).toBe('test-uuid-12345678-1234-5678-9012-123456789012');
    expect(browserStorageMock.set).toHaveBeenCalledWith({ 'faultmaven_client_id': clientId1 });
    expect(browserStorageMock.get).toHaveBeenCalledWith(['faultmaven_client_id']);
  });

  test('uses existing client ID from browser.storage.local', async () => {
    // Pre-set a client ID in storage
    await browserStorageMock.set({ 'faultmaven_client_id': 'existing-client-id' });
    vi.clearAllMocks(); // Clear the mock calls from setup

    const manager = ClientSessionManager.getInstance();
    const clientId = await manager.getOrCreateClientId();

    expect(clientId).toBe('existing-client-id');
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  test('clears client ID correctly', async () => {
    const manager = ClientSessionManager.getInstance();

    // First, create a client ID
    await manager.getOrCreateClientId();
    expect(browserStorageMock.set).toHaveBeenCalled();

    // Then clear it
    await manager.clearClientId();
    expect(browserStorageMock.remove).toHaveBeenCalledWith(['faultmaven_client_id']);

    // Reset mocks and generate new UUID
    vi.clearAllMocks();
    vi.mocked(crypto.randomUUID).mockReturnValue('87654321-4321-5678-9012-123456789012');

    // Next call should generate a new ID
    const newClientId = await manager.getOrCreateClientId();
    expect(newClientId).toBe('87654321-4321-5678-9012-123456789012');
  });

  test('handles session creation with client_id and timeout', async () => {
    const mockSessionResponse = {
      session_id: 'session-123',
      user_id: 'user-123',
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
      'http://localhost:8000/api/v1/sessions',
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
      user_id: 'user-123',
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
      user_id: 'user-123',
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

    expect(browserStorageMock.remove).toHaveBeenCalledWith(['faultmaven_client_id']);
    expect(session.session_id).toBe('new-session-789');
    expect(session.session_resumed).toBe(false);
  });

  test('validates session timeout within acceptable range', async () => {
    const manager = ClientSessionManager.getInstance();

    const mockSessionResponse = {
      session_id: 'session-123',
      user_id: 'user-123',
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

  test('getCurrentClientId returns null when no ID exists', async () => {
    const manager = ClientSessionManager.getInstance();
    const clientId = await manager.getCurrentClientId();
    expect(clientId).toBeNull();
  });

  test('getCurrentClientId returns cached ID when available', async () => {
    // Reset UUID mock to known value
    vi.mocked(crypto.randomUUID).mockReturnValue('cached-test-uuid-9012-123456789012');

    const manager = ClientSessionManager.getInstance();
    // Create a client ID first
    await manager.getOrCreateClientId();

    // Clear mock to verify it uses cache
    vi.clearAllMocks();

    const clientId = await manager.getCurrentClientId();
    expect(clientId).toBe('cached-test-uuid-9012-123456789012');
    // Should use cached value, not call storage again
    expect(browserStorageMock.get).not.toHaveBeenCalled();
  });
});
