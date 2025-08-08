import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock browser APIs for testing
global.browser = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
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
global.chrome = global.browser as any;

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
