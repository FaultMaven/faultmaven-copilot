/**
 * A case delete refused by the delete gate (contract 14.14.0, faultmaven#2096)
 * cleared nothing, so the case stays listed under the refusal's own message.
 *
 * Drives the real `deleteCase` down to the wire, so both error shapes are the
 * ones the client really throws: `authenticatedFetch`'s enriched `Error` on the
 * common path, and the `HttpError` `deleteCase` builds after a credential
 * refresh (401, then the refusal), which the duplicate branch used to read as
 * "already deleted" and hide.
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
const CASE_URL = `${BASE}/api/v1/cases/c-mine`;
const TITLE = 'My disk pressure';
const MINE = {
  case_id: 'c-mine',
  title: TITLE,
  state: 'investigating',
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  owner_id: 'u1',
  driver_id: 'u1',
  enterprise_id: 'e1',
  organization_id: null,
  closure_reason: null,
  closed_at: null,
};

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers(headers),
  json: async () => body,
});

/** The delete route's refusal, as the API sends it. */
const refusal = (status: number, code: string) =>
  wire(status, { detail: { schema_version: '3.1.0', error: { code, message: 'Nothing was deleted; try again.' } } }, {
    'x-error-code': code,
    'Retry-After': '5',
  });

/** Each DELETE is answered by the next response; `afterRefresh` puts a 401 first. */
function routeDelete(response: ReturnType<typeof wire>, afterRefresh: boolean) {
  const answers = afterRefresh ? [wire(401, { detail: 'token expired' }), response] : [response];
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    if (url === CASE_URL && init.method === 'DELETE') return Promise.resolve(answers.shift());
    return Promise.reject(new Error(`unrouted ${init.method ?? 'GET'} ${url}`));
  });
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

async function deleteMine() {
  render(<ConversationsList onCaseSelect={() => {}} onNewSession={() => {}} currentUserId="u1" />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: `Menu for ${TITLE}` }));
  fireEvent.click(screen.getByText('Delete'));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  getUserCases.mockResolvedValue([MINE]);
  setApiTransport({
    baseUrl: async () => BASE,
    accessToken: async () => 'test-token',
    sessionId: async () => null,
    clearSession: async () => undefined,
    onUnauthorized: async () => 'refreshed' as const,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const shapes = [['the common path', false], ['after a credential refresh (HttpError)', true]] as const;
const refusals = [
  [409, 'CASE_WORK_IN_PROGRESS', "This case can't be deleted while FaultMaven is still working on it. Try again in a moment."],
  [503, 'CASE_DELETE_UNAVAILABLE', "This case couldn't be deleted just now. Try again in a moment."],
] as const;

describe('ConversationsList — a delete the gate refused', () => {
  describe.each(refusals)('%i %s', (status, code, message) => {
    it.each(shapes)('%s: keeps the case listed and says why', async (_label, afterRefresh) => {
      routeDelete(refusal(status, code), afterRefresh);
      await deleteMine();

      expect(fetchWithTimeout).toHaveBeenCalledTimes(afterRefresh ? 2 : 1);
      expect(screen.getByText(TITLE)).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByText(/recently deleted/)).toBeNull();
      expect(screen.queryByText(/Failed to delete case/)).toBeNull();

      // Past the duplicate branch's 3 s and the message's 5 s: never hidden.
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(screen.getByText(TITLE)).toBeInTheDocument();
      expect(screen.queryByText(message)).toBeNull();
    });
  });

  it('a DUPLICATE_REQUEST 409 after a refresh keeps today’s duplicate branch: hidden, then re-read', async () => {
    routeDelete(wire(409, { message: 'Duplicate request' }, { 'x-error-code': 'DUPLICATE_REQUEST' }), true);
    await deleteMine();

    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByText('This case was recently deleted or is already being processed. Refreshing...')).toBeInTheDocument();
    const listReads = getUserCases.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(getUserCases.mock.calls.length).toBe(listReads + 1);
  });
});
