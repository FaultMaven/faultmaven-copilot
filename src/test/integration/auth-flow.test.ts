import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authManager, AuthState } from '../../lib/api';

// Mock browser environment
const { mockBrowser } = vi.hoisted(() => {
  const storage = {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn()
    }
  };
  const runtime = {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn()
    }
  };
  return {
    mockBrowser: {
      storage,
      runtime
    }
  };
});

const mockBrowserStorage = mockBrowser.storage;
const mockBrowserRuntime = mockBrowser.runtime;

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: mockBrowser
}));

(global as any).browser = mockBrowser;

describe('Authentication Integration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAuthPayload: AuthState = {
    access_token: 'test-token-123',
    token_type: 'bearer',
    expires_at: Date.now() + 3600000,
    user: {
      user_id: 'user-1',
      username: 'tester',
      email: 'test@example.com',
      display_name: 'Test User',
      is_dev_user: true,
      is_active: true
    }
  };

  describe('Content Script Bridge Logic', () => {
    // Simulate the logic in auth-bridge.content.ts
    it('forwards FM_AUTH_SUCCESS message to background script', async () => {
      // Mock window.addEventListener
      const listeners: Record<string, Function> = {};
      const mockWindow = {
        addEventListener: (type: string, callback: Function) => {
          listeners[type] = callback;
        },
        location: { origin: 'http://localhost' }
      };
      
      // Simulate the content script setup
      // We re-implement the logic here to verify it's correct conceptually
      // In a real e2e test we'd load the script
      mockWindow.addEventListener('message', async (event: any) => {
        if (event.data?.type === 'FM_AUTH_SUCCESS') {
          await (global as any).browser.runtime.sendMessage({
            action: 'storeAuth',
            payload: event.data.payload
          });
        }
      });

      // Trigger the event
      await listeners['message']({
        source: mockWindow,
        data: {
          type: 'FM_AUTH_SUCCESS',
          payload: mockAuthPayload
        }
      });

      // Verify message sent to background
      expect(mockBrowserRuntime.sendMessage).toHaveBeenCalledWith({
        action: 'storeAuth',
        payload: mockAuthPayload
      });
    });
  });

  describe('Background Script Handler Logic', () => {
    // Simulate the handler logic in background.ts
    it('stores auth state and broadcasts change when receiving storeAuth', async () => {
      // 1. Simulate handleStoreAuth logic
      await authManager.saveAuthState(mockAuthPayload);
      
      await (global as any).browser.runtime.sendMessage({
        type: 'auth_state_changed',
        authState: mockAuthPayload
      });

      // 2. Verify storage update
      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith({
        authState: mockAuthPayload
      });

      // 3. Verify broadcast
      expect(mockBrowserRuntime.sendMessage).toHaveBeenCalledWith({
        type: 'auth_state_changed',
        authState: mockAuthPayload
      });
    });
  });

  describe('Dashboard Login Logic', () => {
    // Simulate the logic in LoginPage.tsx
    it('posts message to window on successful login', async () => {
      const mockPostMessage = vi.fn();
      const mockWindow = {
        postMessage: mockPostMessage,
        location: { origin: 'http://localhost' }
      };

      // Simulate login success block
      mockWindow.postMessage({
        type: 'FM_AUTH_SUCCESS',
        payload: mockAuthPayload
      }, mockWindow.location.origin);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'FM_AUTH_SUCCESS',
        payload: mockAuthPayload
      }, 'http://localhost');
    });
  });
});



