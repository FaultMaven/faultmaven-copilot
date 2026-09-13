import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OptionsApp } from '../../entrypoints/options/main';

/**
 * The options page's host-permission state (faultmaven-copilot#258).
 *
 * These render the REAL component. The existing `host-permission-request.test.ts`
 * copies `ensureOriginPermission` into itself and exercises the copy, which is
 * structurally incapable of catching a defect in the page — and did not catch
 * any of the four this file now pins.
 *
 * `hasDashboardOriginPermission` is deliberately NOT mocked: the point of
 * extracting it was that this page and the auth-bridge reconciler ask one
 * question, so the test runs the reconciler's own function against the mocked
 * `browser.permissions`.
 */

/**
 * Declared through `vi.hoisted` because the component is imported STATICALLY.
 * `vi.mock` factories are hoisted above every import, so with a plain `const`
 * they run in its temporal dead zone and the whole file fails to collect. The
 * static import is what matters: a dynamic `import()` per test (with
 * `resetModules`) re-transformed this 600-line module every time and pushed one
 * test past the 5s timeout under full-suite load, which the pre-commit hook
 * caught.
 */
const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  saved: { api: 'https://api.faultmaven.ai', dash: 'https://app.faultmaven.ai' },
  permissions: {
    contains: vi.fn(),
    request: vi.fn(),
    onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  setEndpoints: vi.fn(),
}));

h.permissions.contains.mockImplementation(async ({ origins }: { origins: string[] }) =>
  origins.every((o) => h.granted.has(o)),
);
h.permissions.request.mockImplementation(async ({ origins }: { origins: string[] }) => {
  origins.forEach((o) => h.granted.add(o));
  return true;
});

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: h.permissions,
    runtime: { getManifest: () => ({ version: '1.0.4' }) },
    storage: { local: { set: vi.fn(async () => undefined), get: vi.fn(async () => ({})) } },
  },
}));

vi.mock('@faultmaven/copilot-ui/lib/capabilities', () => ({
  capabilitiesManager: { fetch: vi.fn(async () => { throw new Error('offline'); }) },
}));

vi.mock('../../extension/auth/auth-manager', () => ({
  authManager: { getCurrentUser: vi.fn(async () => null), clearAllAuthData: vi.fn() },
}));

vi.mock('../../extension/host/install', () => ({ installExtensionHostContext: () => {} }));

vi.mock('../../extension/host/endpoints', () => ({
  getApiUrl: vi.fn(async () => h.saved.api),
  getDashboardUrl: vi.fn(async () => h.saved.dash),
  setEndpoints: h.setEndpoints,
  validateEndpointUrl: (url: string) =>
    /^https:\/\//.test(url) || /^https?:\/\/localhost(:\d+)?$/.test(url)
      ? null
      : 'must use https',
}));

vi.mock('@faultmaven/copilot-ui/lib/host-endpoints', () => ({
  getHostEndpoints: () => ({ dashboardUrl: async () => h.saved.dash }),
}));

const API_ORIGIN = 'https://api.faultmaven.ai/*';
const DASH_ORIGIN = 'https://app.faultmaven.ai/*';

const WARNING = /does not have access/i;
const SIGN_IN = /chat cannot sign in/i;
const TWO_PANELS = /two chat panels/i;

async function renderPage() {
  const view = render(<OptionsApp />);
  // Let loadSettings and the permission check settle.
  await waitFor(() => expect(h.permissions.contains).toHaveBeenCalled());
  return view;
}

describe('the options page host-permission warning', () => {
  beforeEach(() => {
    h.granted.clear();
    h.granted.add(API_ORIGIN);
    h.granted.add(DASH_ORIGIN);
    h.saved.api = 'https://api.faultmaven.ai';
    h.saved.dash = 'https://app.faultmaven.ai';
    h.permissions.contains.mockClear();
    h.permissions.request.mockClear();
    h.permissions.onAdded.addListener.mockClear();
    h.permissions.onAdded.removeListener.mockClear();
    h.permissions.onRemoved.addListener.mockClear();
    h.permissions.onRemoved.removeListener.mockClear();
  });

  it('says nothing while the answer is unknown', async () => {
    // `null`, not `false`. A warning rendered before the first `contains()`
    // resolves accuses a correctly-configured user on every single load.
    render(<OptionsApp />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it('says nothing when both origins are held', async () => {
    await renderPage();
    await waitFor(() => expect(screen.queryByText(WARNING)).not.toBeInTheDocument());
  });

  it('names ONLY the dashboard consequence when only the dashboard origin is missing', async () => {
    // The union check reported "chat cannot sign in" here, which is false —
    // sign-in goes through the API origin and works fine.
    h.granted.delete(DASH_ORIGIN);
    await renderPage();
    await waitFor(() => expect(screen.getByText(TWO_PANELS)).toBeInTheDocument());
    expect(screen.queryByText(SIGN_IN)).not.toBeInTheDocument();
  });

  it('names ONLY the sign-in consequence when only the API origin is missing', async () => {
    // …and the mirror image: the union warned about two chat panels for someone
    // whose auth bridge is registered and yielding correctly.
    h.granted.delete(API_ORIGIN);
    await renderPage();
    await waitFor(() => expect(screen.getByText(SIGN_IN)).toBeInTheDocument());
    expect(screen.queryByText(TWO_PANELS)).not.toBeInTheDocument();
  });

  it('names both when both are missing', async () => {
    h.granted.clear();
    await renderPage();
    await waitFor(() => expect(screen.getByText(SIGN_IN)).toBeInTheDocument());
    expect(screen.getByText(TWO_PANELS)).toBeInTheDocument();
  });

  it('does NOT accuse a working setup because the form was touched', async () => {
    // The regression this file exists for. Choosing "Standalone (localhost)"
    // from the dropdown changes the DRAFT to localhost — an optional host
    // permission nobody holds until they save — and the warning appeared on a
    // correctly-configured Cloud install that had changed nothing.
    await renderPage();
    const select = screen.getByLabelText(/server type/i);

    await act(async () => {
      fireEvent.change(select, { target: { value: 'localhost' } });
    });

    await waitFor(() => expect(screen.queryByText(WARNING)).not.toBeInTheDocument());
    // And nothing re-asked the browser about the draft origins.
    for (const call of h.permissions.contains.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('localhost');
    }
  });

  it('requests the SAVED origins, never the unsaved draft', async () => {
    // `handleSave` refuses a non-https custom URL, so granting for the draft
    // would hand a permanent host permission to an origin the save path would
    // have rejected — and that nothing persists, so it cannot be revoked by
    // changing settings.
    h.granted.clear();
    await renderPage();
    await waitFor(() => expect(screen.getByText(WARNING)).toBeInTheDocument());

    const apiField = screen.getByLabelText(/api base url/i);
    await act(async () => {
      fireEvent.change(apiField, { target: { value: 'http://evil.example.com:8090' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /grant access/i }));
    });

    const requested = h.permissions.request.mock.calls.flatMap(
      (call: any[]) => (call[0] as { origins: string[] }).origins,
    );
    expect(requested).toContain(API_ORIGIN);
    expect(requested.join(' ')).not.toContain('evil.example.com');
  });

  it('does not promise the open Dashboard tab has already recovered', async () => {
    // `scripting.registerContentScripts` does not inject into tabs that are
    // already loaded, so the tab the user is complaining about keeps its two
    // panels until it is reloaded. "The Copilot can talk to your server again"
    // claimed a recovery that had not happened.
    h.granted.clear();
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /grant access/i }));
    });
    await waitFor(() => expect(screen.getByText(/reload any open dashboard tab/i)).toBeInTheDocument());
  });

  it('subscribes to permission changes and unsubscribes on unmount', async () => {
    const { unmount } = await renderPage();
    expect(h.permissions.onAdded.addListener).toHaveBeenCalled();
    expect(h.permissions.onRemoved.addListener).toHaveBeenCalled();

    unmount();
    expect(h.permissions.onAdded.removeListener).toHaveBeenCalled();
    expect(h.permissions.onRemoved.removeListener).toHaveBeenCalled();
  });

  it('ignores an answer that arrives after unmount', async () => {
    // The stale-response guard. `contains()` is a cross-process call and
    // several can be in flight; without the guard a late resolve writes state
    // on an unmounted tree (and, before that, an answer about origins that are
    // no longer configured could win).
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((e) => { errors.push(e); });

    let release!: (v: boolean) => void;
    h.permissions.contains.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { release = resolve; }),
    );

    const { unmount } = render(<OptionsApp />);
    await waitFor(() => expect(h.permissions.contains).toHaveBeenCalled());
    unmount();

    await act(async () => {
      release?.(false);
      await Promise.resolve();
    });

    expect(errors.join(' ')).not.toMatch(/unmounted/i);
    spy.mockRestore();
  });
});
