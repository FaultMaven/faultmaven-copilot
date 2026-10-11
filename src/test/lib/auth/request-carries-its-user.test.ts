/**
 * A request is sent with a credential belonging to the user it was built for,
 * or not at all (copilot#350).
 *
 * Between another user (B) signing in on the same browser profile — the
 * Dashboard bridge, say — and the panel applying it, the panel still builds
 * requests for A. The credential read used to hand out whatever was stored, so
 * those requests went out with B's bearer. Most are refused server-side (A's
 * case is not B's), but one that names no existing resource — `POST /cases`
 * with A's first message — would create A's content in B's account.
 *
 * Driven through the REAL extension transport, act-site and token manager over
 * one in-memory storage; only `fetch` is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store, mockStorage, sendMessage } = vi.hoisted(() => {
  type Keys = string | string[] | null | undefined;
  const store: Record<string, unknown> = {};
  const read = (keys: Keys) => {
    if (keys == null) return { ...store };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (store[k] !== undefined) out[k] = store[k];
    return out;
  };
  const mockStorage = {
    local: {
      get: vi.fn(async (keys: Keys) => read(keys)),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      }),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  return { store, mockStorage, sendMessage };
});

vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockStorage,
    runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
  },
}));

const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../../extension/auth/auth-config', () => ({ getAuthConfig: mockGetAuthConfig }));

import { createExtensionTransport } from '../../../extension/host/extension-transport';
import { authManager } from '../../../extension/auth/auth-manager';
import { readSessionAccessToken } from '../../../extension/host/session-credential';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { createCase } from '@faultmaven/copilot-ui/lib/api/services/case-service';
import type { HostSession } from '@faultmaven/copilot-ui/shared/host';

const API = 'https://api.example.test';
const HOUR = 3_600_000;

const EXPIRES = Date.now() + HOUR;
const sessionOf = (userId: string | null, token: string) => ({
  access_token: token,
  token_type: 'bearer',
  expires_at: EXPIRES,
  refresh_token: `${token}-refresh`,
  ...(userId ? { user: { user_id: userId } } : {}),
  authState: { access_token: token, expires_at: EXPIRES, ...(userId ? { user: { user_id: userId } } : {}) },
});

/**
 * The panel's session for `userId`, as `ExtensionApp` assembles it — its bearer
 * comes from the act-site — and the extension's transport is built from it.
 */
const panelFor = (userId: string) =>
  ({
    user: { id: userId, username: userId, roles: ['user'] },
    accessToken: () => readSessionAccessToken(userId),
    onUnauthorized: async () => 'ended' as const,
    signOut: async () => {},
    subscribeAuthState: () => () => {},
  }) as unknown as HostSession;

const createdCase = {
  ok: true,
  status: 201,
  headers: new Headers(),
  json: async () => ({
    case_id: 'case-1',
    title: 'A',
    state: 'inquiry',
    enterprise_id: 'ent-1',
    user_id: 'user-a',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }),
  text: async () => '{"case_id":"case-1"}',
};

const bearersSent = () =>
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => {
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    return headers?.Authorization ?? headers?.authorization ?? null;
  });

describe('a request carries the user it was built for', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.clearAllMocks();
    setHostStore({
      get: (keys) => mockStorage.local.get(keys),
      set: (items) => mockStorage.local.set(items),
      remove: (keys) => mockStorage.local.remove(keys),
      subscribe: () => () => {},
    });
    setHostEndpoints({
      apiUrl: async () => API,
      dashboardUrl: async () => 'https://dashboard.example.test',
      subscribe: () => () => {},
    });
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    global.fetch = vi.fn().mockResolvedValue(createdCase) as unknown as typeof fetch;
    setApiTransport(createExtensionTransport(panelFor('user-a')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an A-built POST /cases after B's sign-in sends nothing", async () => {
    Object.assign(store, sessionOf('user-b', 'b-access'));

    const attempt = createCase({ title: 'A first message' } as never);

    await expect(attempt).rejects.toMatchObject({ name: 'SessionSwitchedError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refusing it neither ends B's session nor tells anyone to sign out", async () => {
    Object.assign(store, sessionOf('user-b', 'b-access'));
    const teardown = vi.spyOn(authManager, 'clearAllAuthData');

    await createCase({ title: 'A first message' } as never).catch(() => {});

    expect(teardown).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.access_token).toBe('b-access');
    expect(store.refresh_token).toBe('b-access-refresh');
    expect(store.authState).toEqual(sessionOf('user-b', 'b-access').authState);
  });

  it("the same user's rotated credential still flows", async () => {
    Object.assign(store, sessionOf('user-a', 'a2-access'));

    await expect(createCase({ title: 'A' } as never)).resolves.toMatchObject({ case_id: 'case-1' });
    expect(bearersSent()).toEqual(['Bearer a2-access']);
  });

  it('a stored credential that names NO user is not handed to a panel that has one', async () => {
    // Every writer stores `user` beside the token, so a credential without one
    // is not a session this panel can be shown to own. Unknown is never the
    // same user — the rule #348's teardown uses — and nothing is sent.
    Object.assign(store, sessionOf(null, 'anon-access'));

    await expect(createCase({ title: 'A' } as never)).rejects.toMatchObject({
      name: 'SessionSwitchedError',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.access_token).toBe('anon-access');
  });
});
