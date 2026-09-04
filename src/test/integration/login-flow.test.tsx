import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtensionApp } from '../../extension/ExtensionApp';
import { capabilitiesManager } from '../../lib/capabilities';
import React from 'react';

// Mock dependencies
vi.mock('../../lib/capabilities');
// No auth stub. WHO is signed in is the extension's own question now — it asks
// its credential stack directly — and this file's storage mock holds no
// `authState`, so the real gate answers "nobody" and renders the sign-in screen.
// That is stronger than the stub it replaces: the path under test is the real
// one.
vi.mock('../../lib/errors', () => ({
  useErrorHandler: () => ({ getErrorsByType: () => [], dismissError: vi.fn() }),
  useError: () => ({ showError: vi.fn() }),
  ErrorHandlerProvider: ({ children }: any) => children
}));
vi.mock('../../lib/auth/auth-config', () => ({
  getAuthConfig: vi.fn().mockResolvedValue({
    provider: 'oidc',
    features: {
      supports_registration: false,
      supports_password_reset: false,
      supports_mfa: false
    }
  })
}));

// Mock browser global and wxt/browser
const storageMock = {
  local: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  }
};

const runtimeMock = {
  openOptionsPage: vi.fn(),
  onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  sendMessage: vi.fn().mockResolvedValue({ status: 'success' })
};

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined)
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    runtime: {
      openOptionsPage: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue({ status: 'success' })
    },
    tabs: {
      query: vi.fn().mockResolvedValue([])
    }
  }
}));

import { browser } from 'wxt/browser'; // Import the mocked browser
import { setHostStore } from '../../lib/host-store';

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: { VITE_DASHBOARD_URL: 'http://localhost:3333' } } });

describe('SidePanelApp Login Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // This file mocks wxt/browser for itself; the bridge must answer from THAT
    // mock or initializeApp reads an empty store and shows first-run setup.
    setHostStore({
      get: (keys) => browser.storage.local.get(keys),
      set: (items) => browser.storage.local.set(items),
      remove: (keys) => browser.storage.local.remove(keys),
      subscribe: () => () => {},
    });
    (capabilitiesManager.fetch as any).mockResolvedValue({
      dashboardUrl: 'https://test-dashboard.faultmaven.ai'
    });
  });

  it('initiates Dashboard OAuth flow when "Sign In to Work" is clicked', async () => {
    // Render the app (will show login screen since isAuthenticated is false)
    // We need to bypass the WelcomeScreen check
    (browser.storage.local.get as any).mockResolvedValue({ hasCompletedFirstRun: true });

    // The sign-in screen now belongs to the extension's own entry point, so
    // this renders that rather than the shared panel — which, with no session,
    // cannot be mounted at all.
    render(<ExtensionApp />);

    // Find the OAuth login button (for OIDC provider)
    const loginButton = await screen.findByText('Sign in with Organization');
    expect(loginButton).toBeInTheDocument();

    // Click it
    fireEvent.click(loginButton);

    // Verify browser.runtime.sendMessage was called to initiate OAuth flow
    await waitFor(() => {
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'initiateOIDCLogin'
      });
    });
  });
});

