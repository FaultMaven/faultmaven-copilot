/**
 * A failed delete still drops the cached list page (#387).
 *
 * The case list reloads after a failed delete to learn whether the case is
 * still listed, and a delete whose answer was lost may have committed. A
 * reload served from the 5-minute slot would only repeat the page from before
 * the delete, so `deleteCase` drops the slot whatever its answer.
 *
 * Driven down to `fetchWithTimeout`, with the real case service and the real
 * cache over a stub host store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { deleteCase, getUserCases, SIDEBAR_CASE_LIST_QUERY } from '@faultmaven/copilot-ui/lib/api';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const BASE = 'http://localhost:8090';
const row = (id: string) => ({
  case_id: id, title: id, state: 'investigating', user_id: 'u1', driver_id: 'u1', enterprise_id: 'e1',
  created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z',
});
const wire = (status: number, body: unknown) =>
  ({ ok: status < 300, status, statusText: '', headers: new Headers(), json: async () => body });

/** What the server lists; the DELETE answers with `deleteAnswer`. */
let listed: string[];
let deleteAnswer: () => Promise<unknown>;

const listReads = () =>
  (fetchWithTimeout.mock.calls as [string, RequestInit?][])
    .filter(([u, init]) => new URL(u).pathname === '/api/v1/cases' && (init?.method ?? 'GET') === 'GET').length;
const sidebarIds = async () => (await getUserCases(SIDEBAR_CASE_LIST_QUERY)).map((c) => c.case_id);

beforeEach(async () => {
  vi.clearAllMocks();
  setHostStore(createStubHost().store);
  setApiTransport({
    baseUrl: async () => BASE,
    accessToken: async () => 'test-token',
    sessionId: async () => null,
    clearSession: async () => undefined,
    onUnauthorized: async () => 'ended' as const,
  });
  listed = ['case-A', 'case-B'];
  fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/cases') return wire(200, { cases: listed.map(row) });
    if (path === '/api/v1/cases/case-A' && init.method === 'DELETE') return deleteAnswer();
    throw new Error(`unrouted ${init.method ?? 'GET'} ${url}`);
  });
  await caseCacheManager.invalidateCache();
  // Warm the slot: the sidebar's page lists A and B.
  expect(await sidebarIds()).toEqual(['case-A', 'case-B']);
  expect(listReads()).toBe(1);
});

describe('deleteCase drops the cached list page whatever its answer (#387)', () => {
  it.each([
    {
      name: 'a 500 (the delete may have committed before the error)',
      answer: async () => { listed = ['case-B']; return wire(500, { detail: 'boom' }); },
    },
    {
      name: 'a lost answer (the request committed, the response never came back)',
      answer: async () => { listed = ['case-B']; throw new TypeError('Failed to fetch'); },
    },
    {
      name: 'a refusal (CASE_WORK_IN_PROGRESS: nothing cleared)',
      answer: async () => wire(409, { detail: { error: { code: 'CASE_WORK_IN_PROGRESS' } } }),
    },
  ])('after $name, the next sidebar read is the server’s list', async ({ answer }) => {
    deleteAnswer = answer;

    await expect(deleteCase('case-A')).rejects.toBeTruthy();

    const ids = await sidebarIds();
    expect(listReads()).toBe(2);
    expect(ids).toEqual(listed);
  });

  it('after a delete that succeeded, likewise', async () => {
    deleteAnswer = async () => { listed = ['case-B']; return wire(204, null); };

    await deleteCase('case-A');

    expect(await sidebarIds()).toEqual(['case-B']);
    expect(listReads()).toBe(2);
  });
});
