import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock browser APIs for testing
(global as any).browser = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  sidePanel: {
    open: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(),
  },
} as any;

// Mock fetch for API testing
global.fetch = vi.fn();

// Mock chrome API (for backward compatibility)
(global as any).chrome = (global as any).browser;

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    href: 'https://example.com',
  },
  writable: true,
});

// Mock navigator
Object.defineProperty(window, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Test Browser)',
  },
  writable: true,
});

// A host always installs a transport before the shared UI issues a request, so
// the suite reflects that rather than every test file re-stating it. Backed by
// the same global `browser` mock above, so the values a request carries are the
// ones a test stages there. Individual tests override with setApiTransport().
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { beforeEach as _beforeEach } from 'vitest';

_beforeEach(() => {
  // A host always installs its store before the shared UI reads state.
  setHostStore({
    get: (keys: string[]) => (global as any).browser.storage.local.get(keys),
    set: (items: Record<string, unknown>) => (global as any).browser.storage.local.set(items),
    remove: (keys: string[]) => (global as any).browser.storage.local.remove(keys),
    subscribe: (_keys: string[], _onChange: (c: Record<string, unknown>) => void) => () => {},
  });
  // …and its endpoints, which every extension context installs at its entry
  // point, before any credential or capability call resolves a backend URL.
  setHostEndpoints({
    apiUrl: async () => 'http://localhost:8090',
    dashboardUrl: async () => 'http://localhost:3333',
    subscribe: (_onChange: () => void) => () => {},
  });
  setApiTransport({
    baseUrl: async () => 'http://localhost:8090',
    accessToken: async () => {
      const stored = await (global as any).browser.storage.local.get(['authState']);
      const token = stored?.authState?.access_token;
      if (!token) throw new Error('test transport: no access token staged');
      return token;
    },
    sessionId: async () => {
      const stored = await (global as any).browser.storage.local.get(['sessionId']);
      return stored?.sessionId ?? null;
    },
    clearSession: async () => {
      await (global as any).browser.storage.local.remove([
        'sessionId', 'sessionCreatedAt', 'sessionResumed',
      ]);
    },
    onUnauthorized: () => {},
  });
});
