import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SidePanelApp from '../../shared/ui/SidePanelApp';
import { capabilitiesManager } from '../../lib/capabilities';
import React from 'react';

// Mock dependencies
vi.mock('../../lib/capabilities');
vi.mock('../../shared/ui/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isAdmin: () => false
  })
}));
vi.mock('../../lib/errors', () => ({
  useErrorHandler: () => ({ getErrorsByType: () => [], dismissError: vi.fn() }),
  useError: () => ({ showError: vi.fn(), showErrorWithRetry: vi.fn() }),
  ErrorHandlerProvider: ({ children }: any) => children
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
      }
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

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: { VITE_DASHBOARD_URL: 'http://localhost:5173' } } });

describe('SidePanelApp Login Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (capabilitiesManager.fetch as any).mockResolvedValue({
      dashboardUrl: 'https://test-dashboard.faultmaven.ai'
    });
  });

  it('initiates Dashboard OAuth flow when "Sign In to Work" is clicked', async () => {
    // Render the app (will show login screen since isAuthenticated is false)
    // We need to bypass the WelcomeScreen check
    (browser.storage.local.get as any).mockResolvedValue({ hasCompletedFirstRun: true });

    render(<SidePanelApp />);

    // Find the login button
    const loginButton = await screen.findByText('Sign In to Work');
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

