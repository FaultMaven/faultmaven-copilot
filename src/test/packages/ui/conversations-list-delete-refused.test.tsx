/**
 * A delete refused by the delete gate (contract 14.14.0, faultmaven#2096)
 * cleared nothing, so the case stays listed under the refusal's own message.
 * Drives the real `deleteCase` to the wire, so both error shapes are real:
 * `authenticatedFetch`'s enriched `Error`, and the `HttpError` built after a
 * credential refresh (401, then the refusal), which the duplicate branch used
 * to read as "already deleted" and hide.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ConversationsList from '@faultmaven/copilot-ui/shared/ui/components/ConversationsList';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';

const { getUserCases } = vi.hoisted(() => ({ getUserCases: vi.fn() }));
vi.mock('@faultmaven/copilot-ui/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/api')>()),
  getUserCases,
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const BASE = 'http://localhost:8090';
const TITLE = 'My disk pressure';
const MINE = { case_id: 'c-mine', title: TITLE, state: 'investigating', owner_id: 'u1', driver_id: 'u1', enterprise_id: 'e1',
  created_at: '2026-10-09T09:00:00Z', updated_at: '2026-10-09T09:00:00Z' };
const BUSY = "This case can't be deleted while FaultMaven is still working on it. Try again in a moment.";
const UNAVAILABLE = "This case couldn't be deleted just now. Try again in a moment.";

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, statusText: '', headers: new Headers(headers), json: async () => body });

/** The DELETE answers `code` as the API does; after a refresh, a 401 comes first. */
function routeDelete(status: number, code: string, afterRefresh: boolean) {
  const refusal = wire(status, { detail: { error: { code, message: 'Nothing was deleted; try again.' } } }, {
    'x-error-code': code,
    'Retry-After': '5',
  });
  const answers = afterRefresh ? [wire(401, { detail: 'token expired' }), refusal] : [refusal];
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) =>
    url === `${BASE}/api/v1/cases/c-mine` && init.method === 'DELETE'
      ? Promise.resolve(answers.shift())
      : Promise.reject(new Error(`unrouted ${url}`)));
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function deleteMine(onCasesLoaded?: () => void) {
  render(<ConversationsList onCaseSelect={() => {}} onNewSession={() => {}} currentUserId="u1" onCasesLoaded={onCasesLoaded} />);
  await advance(0);
  fireEvent.click(screen.getByRole('button', { name: `Menu for ${TITLE}` }));
  fireEvent.click(screen.getByText('Delete'));
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  getUserCases.mockResolvedValue([MINE]);
  setApiTransport({ baseUrl: async () => BASE, accessToken: async () => 'test-token', sessionId: async () => null,
    clearSession: async () => undefined, onUnauthorized: async () => 'refreshed' as const });
});

afterEach(() => vi.useRealTimers());

const REFUSALS = [
  { status: 409, code: 'CASE_WORK_IN_PROGRESS', message: BUSY },
  { status: 503, code: 'CASE_DELETE_UNAVAILABLE', message: UNAVAILABLE },
].flatMap((r) => [
  { ...r, shape: 'the common path', afterRefresh: false },
  { ...r, shape: 'after a credential refresh (HttpError)', afterRefresh: true },
]);

describe('ConversationsList — a delete the gate refused', () => {
  it.each(REFUSALS)('$status $code, $shape: keeps the case listed and says why', async ({ status, code, message, afterRefresh }) => {
    routeDelete(status, code, afterRefresh);
    await deleteMine();

    expect(fetchWithTimeout).toHaveBeenCalledTimes(afterRefresh ? 2 : 1);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/recently deleted|Failed to delete case/)).toBeNull();

    // Past the duplicate branch's 3 s and the message's 5 s: never hidden.
    await advance(5000);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByText(message)).toBeNull();
  });

  // The mount's load passes; the refusal's reload does not store the server's list.
  const failReload = (error: Error) => () => {
    getUserCases.mockResolvedValueOnce([MINE]).mockRejectedValueOnce(error);
    return undefined;
  };
  it.each([
    ['rejects (a host callback throws)', () => vi.fn().mockReturnValueOnce(undefined).mockImplementation(() => { throw new Error('host'); })],
    ['is rate-limited (the state is kept)', failReload(Object.assign(new Error('Too many requests'), { status: 429 }))],
    ['fails (the list is emptied)', failReload(new Error('boom'))],
  ] as const)('keeps the row and says why when the reload %s', async (_label, arrange) => {
    routeDelete(409, 'CASE_WORK_IN_PROGRESS', false);
    await deleteMine(arrange());
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(BUSY)).toBeInTheDocument();
  });

  it('a DUPLICATE_REQUEST 409 after a refresh keeps today’s duplicate branch: hidden, then re-read', async () => {
    routeDelete(409, 'DUPLICATE_REQUEST', true);
    await deleteMine();

    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByText('This case was recently deleted or is already being processed. Refreshing...')).toBeInTheDocument();
    const listReads = getUserCases.mock.calls.length;
    await advance(3000);
    expect(getUserCases).toHaveBeenCalledTimes(listReads + 1);
  });
});
