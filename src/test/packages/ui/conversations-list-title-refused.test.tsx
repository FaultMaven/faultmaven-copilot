/**
 * Title generation refused for the case itself (#384, faultmaven#2806). `POST
 * /cases/{id}/title` answers 404 for a case that is gone AND, before #2806, for
 * a reader who does not drive it; after #2806 the second is 403
 * `CASE_NOT_DRIVER`. The row read back says which: a gone case closes and
 * leaves the list, a handed-off one leaves the list and turns read-only, and
 * the status line says what was found instead of the server's "access denied".
 * Real case service down to `fetchWithTimeout`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ConversationsList from '@faultmaven/copilot-ui/shared/ui/components/ConversationsList';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const BASE = 'http://localhost:8090';
const TITLE = 'My disk pressure';
const ROW = { case_id: 'c-mine', title: TITLE, state: 'investigating', user_id: 'u1', driver_id: 'u1', enterprise_id: 'e1',
  created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z' };
const GONE = { detail: 'Case not found or access denied' };
const wire = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, statusText: '', headers: new Headers(headers), json: async () => body });

/** What `POST /title` and `GET /cases/c-mine` answer. */
let titleAnswer: ReturnType<typeof wire>;
let readAnswer: ReturnType<typeof wire>;

beforeEach(async () => {
  vi.clearAllMocks();
  setHostStore(createStubHost().store);
  setApiTransport({ baseUrl: async () => BASE, accessToken: async () => 'test-token', sessionId: async () => null,
    clearSession: async () => undefined, onUnauthorized: async () => 'ended' as const });
  fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (path === '/api/v1/cases' && method === 'GET') return wire(200, { cases: [ROW] });
    if (path === '/api/v1/cases/c-mine/title' && method === 'POST') return titleAnswer;
    if (path === '/api/v1/cases/c-mine' && method === 'GET') return readAnswer;
    throw new Error(`unrouted ${method} ${url}`);
  });
  await caseCacheManager.invalidateCache();
  useAppStore.setState({
    currentUser: { id: 'u1', username: 'me', roles: [] } as never,
    activeCaseId: 'c-mine', hasUnsavedNewChat: false, goneCaseNotice: null, writeDeniedCaseIds: {},
    activeCase: { ...ROW, owner_id: 'u1', closure_reason: null, closed_at: null } as never,
  } as never);
});

async function generateTitle() {
  render(<ConversationsList onCaseSelect={() => {}} onNewSession={() => {}} currentUserId="u1" />);
  await screen.findByText(TITLE);
  fireEvent.click(screen.getByRole('button', { name: `Menu for ${TITLE}` }));
  const reloads = useAppStore.getState().refreshSessions;
  await act(async () => { fireEvent.click(screen.getByText('Generate title')); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return () => useAppStore.getState().refreshSessions - reloads;
}

describe('a title generation refused for the case itself', () => {
  it.each([
    { refusal: 'an unlabelled 404', answer: () => wire(404, GONE) },
    { refusal: '404 CASE_NOT_FOUND', answer: () => wire(404, GONE, { 'x-error-code': 'CASE_NOT_FOUND' }) },
  ])('$refusal, read back gone: the case closes, leaves the list, and the status says so', async ({ answer }) => {
    titleAnswer = answer();
    readAnswer = answer();
    const reloads = await generateTitle();
    expect(screen.getByText('This case no longer exists.')).toBeInTheDocument();
    expect(screen.queryByText(GONE.detail)).toBeNull();
    expect(useAppStore.getState()).toMatchObject({ activeCase: null, goneCaseNotice: { caseId: 'c-mine' } });
    expect(reloads()).toBe(1);
  });

  it.each([
    { refusal: 'an unlabelled 404 (a core before #2806)', answer: () => wire(404, GONE) },
    { refusal: '403 CASE_NOT_DRIVER', answer: () => wire(403, { detail: 'Not the driver' }, { 'x-error-code': 'CASE_NOT_DRIVER' }) },
  ])('$refusal, read back driven by another: read-only, leaves the list, the driver notice', async ({ answer }) => {
    titleAnswer = answer();
    readAnswer = wire(200, { ...ROW, driver_id: 'u2' });
    const reloads = await generateTitle();
    expect(screen.getByText("Only the case's driver can add to it.")).toBeInTheDocument();
    expect(useAppStore.getState().writeDeniedCaseIds['c-mine']).toBe(true);
    expect(useAppStore.getState().goneCaseNotice).toBeNull();
    expect(reloads()).toBe(1);
  });

  it('a 422 (too little context) is not read back: the status says what the server said', async () => {
    titleAnswer = wire(422, { detail: 'Not enough context' });
    readAnswer = wire(200, ROW);
    await generateTitle();
    expect(screen.getByText('Not enough context')).toBeInTheDocument();
    expect(fetchWithTimeout.mock.calls.filter(([u, i]) => u.endsWith('/cases/c-mine') && (i?.method ?? 'GET') === 'GET')).toHaveLength(0);
  });
});
