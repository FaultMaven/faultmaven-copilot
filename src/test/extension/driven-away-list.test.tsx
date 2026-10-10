/**
 * A case the user stops driving leaves the sidebar on every path, not only
 * after a 403 (ADR-020 D8, fm#1898).
 *
 * The sidebar lists the cases its user drives (`access=write`). Two real paths
 * never meet a 403:
 *  (A) reassigned while NOT open — the user clicks its cached row, the
 *      hydrated row names someone else, the panel turns read-only;
 *  (B) reassigned DURING a turn — the turn's 409 CASE_VERSION_CONFLICT
 *      refreshes the row, which names someone else.
 * The extension host (`useActiveCaseDrivenByOther`) then drops the cache slot
 * and reloads the list. It must not loop: after the reload the case is gone
 * from the list, the open case is unchanged, and nothing reloads again.
 *
 * Driven at the wire (`fetchWithTimeout`), with the real case service, the real
 * list cache over a stub host store, the real list and the real host hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useRef } from 'react';
import ConversationsList from '@faultmaven/copilot-ui/shared/ui/components/ConversationsList';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { HostAdapterProvider } from '@faultmaven/copilot-ui/shared/host';
import { useActiveCaseDrivenByOther } from '../../extension/useActiveCaseDriver';
import { createStubHost } from '../support/host';

vi.mock('@faultmaven/copilot-ui/lib/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/errors')>()),
  useError: () => ({ showError: vi.fn(), dismissError: vi.fn() }),
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const BASE = 'http://localhost:8090';
const CASE = 'c-mine';
const TITLE = 'My disk pressure';

/** Who drives the case on the server right now. The viewer is u1, its creator. */
let drivenBy = 'u1';

const caseRow = () => ({
  case_id: CASE,
  title: TITLE,
  state: 'investigating',
  closure_reason: null,
  closed_at: null,
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  user_id: 'u1',
  driver_id: drivenBy,
  enterprise_id: 'e1',
});

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

const listReads = () =>
  (fetchWithTimeout.mock.calls as [string, RequestInit?][])
    .map(([u]) => new URL(u))
    .filter((u) => u.pathname === '/api/v1/cases' && u.searchParams.get('access') === 'write');

function routeServer() {
  fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    if (u.pathname === '/api/v1/cases' && method === 'GET') {
      // The server's `access=write` answer: the case only while u1 drives it.
      return wire(200, { cases: drivenBy === 'u1' ? [caseRow()] : [] });
    }
    if (u.pathname === `/api/v1/cases/${CASE}` && method === 'GET') return wire(200, caseRow());
    if (u.pathname === `/api/v1/cases/${CASE}/messages`) return wire(200, { messages: [], total_count: 0 });
    if (u.pathname === `/api/v1/cases/${CASE}/turns` && method === 'POST') {
      // Reassigned while the turn ran: the version bump refuses it.
      return wire(409, { detail: 'Case changed' }, {
        'x-error-code': 'CASE_VERSION_CONFLICT',
        'x-expected-version': '4',
        'x-actual-version': '5',
      });
    }
    throw new Error(`unrouted ${method} ${url}`);
  });
}

/** The extension's composition: the host hook beside the sidebar it reloads. */
let submit: ((q: string) => Promise<unknown>) | null = null;
function ExtensionShape() {
  useActiveCaseDrivenByOther('u1');
  const refresh = useAppStore((s) => s.refreshSessions);
  const { handleQuerySubmit } = useMessageSubmission();
  const ref = useRef(handleQuerySubmit);
  ref.current = handleQuerySubmit;
  submit = (q) => ref.current(q);
  return (
    <ConversationsList
      onCaseSelect={(id) => useAppStore.getState().handleCaseSelect(id)}
      onNewSession={() => {}}
      currentUserId="u1"
      refreshTrigger={refresh}
    />
  );
}

let stub: ReturnType<typeof createStubHost>;

beforeEach(async () => {
  vi.clearAllMocks();
  pendingOpsManager.clear();
  drivenBy = 'u1';
  stub = createStubHost();
  setHostStore(stub.store);
  setApiTransport({
    baseUrl: async () => BASE,
    accessToken: async () => 'test-token',
    sessionId: async () => null,
    clearSession: async () => undefined,
    onUnauthorized: async () => 'ended' as const,
  });
  routeServer();
  await caseCacheManager.invalidateCache();
  useAppStore.setState({
    sessionId: 'session-123',
    currentUser: { id: 'u1', username: 'me', roles: [] } as never,
    activeCaseId: null,
    activeCase: null,
    hasUnsavedNewChat: false,
    conversations: {},
    titleSources: {},
    conversationTitles: {},
    pinnedCases: new Set(),
    writeDeniedCaseIds: {},
    // A non-zero counter makes the list load twice on mount.
    refreshSessions: 0,
  } as never);
});

const mount = async () => {
  render(
    <HostAdapterProvider value={stub.host}>
      <ExtensionShape />
    </HostAdapterProvider>,
  );
  expect(await screen.findByText(TITLE)).toBeInTheDocument();
  // The sidebar's first page is now in the cache slot.
  expect((await caseCacheManager.getCachedCases())?.map((c) => c.case_id)).toEqual([CASE]);
};

/** Let any further reload land, then prove none did. */
const settled = async (reads: number) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(listReads()).toHaveLength(reads);
};

describe('a case the user stops driving leaves the sidebar without a 403', () => {
  it('(A) reassigned while not open: opening it drops it from the list, through a fresh read', async () => {
    await mount();
    expect(listReads()).toHaveLength(1);

    drivenBy = 'u2';
    await act(async () => {
      fireEvent.click(screen.getByText(TITLE));
    });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    // Not served the cached page that still listed it: the server was asked.
    expect(listReads()).toHaveLength(2);
    // The open case is unchanged, and read as someone else's.
    expect(useAppStore.getState().activeCase).toMatchObject({ case_id: CASE, driver_id: 'u2' });
    expect(await caseCacheManager.getCachedCases()).toEqual([]);
    // No loop.
    await settled(2);
  });

  it('(B) reassigned during a turn: the 409 refresh drops it from the list', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByText(TITLE));
    });
    await waitFor(() => expect(useAppStore.getState().activeCase?.driver_id).toBe('u1'));
    await settled(1);

    drivenBy = 'u2';
    await act(async () => {
      await submit!('why is the disk full?');
    });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(listReads()).toHaveLength(2);
    expect(useAppStore.getState().activeCase).toMatchObject({ case_id: CASE, driver_id: 'u2' });
    const posts = (fetchWithTimeout.mock.calls as [string, RequestInit?][]).filter(
      ([u, i]) => u.endsWith('/turns') && i?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    await settled(2);
  });

  it('contrast: opening a case the user still drives reloads nothing', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByText(TITLE));
    });
    await waitFor(() => expect(useAppStore.getState().activeCase?.driver_id).toBe('u1'));
    await settled(1);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });
});
