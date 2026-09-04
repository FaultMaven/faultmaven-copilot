/**
 * Test host: a real in-memory `HostStore` behind the same context the
 * production hosts use.
 *
 * The point is not convenience. A converted hook can only be exercised through
 * a mounted host, so a test that renders one and asserts on THIS store is
 * evidence that the hook reaches storage through the adapter — if the call site
 * still went to `browser.storage.local`, the global mock in `setup.ts` would
 * answer it silently and the assertion here would find nothing.
 */
import React from 'react';
import { vi } from 'vitest';
import { HostAdapterProvider } from '../../shared/host';
import type {
  HostPageCapture,
  HostSession,
  HostStore,
  HostUser,
  StoredValue,
  WiredHost,
} from '../../shared/host';

type ChangeHandler = (changed: Record<string, StoredValue>) => void;

export interface StubHost {
  /** Pass to `renderHook(fn, { wrapper: hostWrapper(stub) })`. */
  host: WiredHost;
  store: HostStore;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  /** navigation.dashboard */
  dashboard: ReturnType<typeof vi.fn>;
  /** navigation.settings — a spy, or null for a host with no settings surface. */
  settings: ReturnType<typeof vi.fn> | null;
  /** pageCapture.capture — a spy on the supporting arm, null on the other. */
  capture: ReturnType<typeof vi.fn> | null;
  /** session.signOut — a spy, or null for a host that owns sign-out itself. */
  signOut: ReturnType<typeof vi.fn> | null;
  /** session.accessToken */
  accessToken: ReturnType<typeof vi.fn>;
  /** session.onUnauthorized — the host's answer to a rejected credential. */
  onUnauthorized: ReturnType<typeof vi.fn>;
  /** session.subscribeAuthState */
  subscribeAuthState: ReturnType<typeof vi.fn>;
  /** Tell every auth-state subscriber the identity changed. `null` = signed out. */
  authStateChanged: (user: HostUser | null) => void;
  endpoints: WiredHost['endpoints'];
  apiUrl: ReturnType<typeof vi.fn>;
  dashboardUrl: ReturnType<typeof vi.fn>;
  endpointsChanged: () => void;
  /** What the store currently holds. Mutate to stage a read. */
  data: Record<string, StoredValue>;
  /** Deliver a change to every subscriber that asked for one of these keys. */
  emit(changed: Record<string, StoredValue>): void;
}

export interface StubHostOptions {
  /**
   * Whether this host HAS a settings surface. `false` produces
   * `navigation.settings === null`, which is the case the shared UI must render
   * no settings affordance for — the web host's permanent answer.
   */
  settings?: boolean;
  /**
   * Whether this host can read the page the user is looking at. `false`
   * produces the `supported: false` arm carrying a reason and an install link —
   * the web host's permanent answer, and the one the shared UI must render an
   * explanation for rather than a dead button.
   */
  pageCapture?: boolean;
  /**
   * Whether this host offers its own sign-out. `false` produces
   * `session.signOut === null` — the web host's answer, where the surrounding
   * app owns the account menu.
   */
  signOut?: boolean;
  /** Roles on the signed-in user; drives anything gated on `admin`. */
  roles?: string[];
}

export const STUB_CAPTURE_REASON =
  'Capturing this page needs the FaultMaven Copilot browser extension.';
export const STUB_INSTALL_URL = 'https://chromewebstore.example.invalid/faultmaven';

export function createStubHost(
  seed: Record<string, StoredValue> = {},
  options: StubHostOptions = {},
): StubHost {
  const data: Record<string, StoredValue> = { ...seed };
  const subscribers: Array<{ keys: string[]; onChange: ChangeHandler }> = [];
  const unsubscribe = vi.fn();

  const get = vi.fn(async (keys: string[]) => {
    const out: Record<string, StoredValue> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
    }
    return out;
  });

  const set = vi.fn(async (items: Record<string, StoredValue>) => {
    Object.assign(data, items);
  });

  const remove = vi.fn(async (keys: string[]) => {
    for (const key of keys) delete data[key];
  });

  const subscribe = vi.fn((keys: string[], onChange: ChangeHandler) => {
    const entry = { keys, onChange };
    subscribers.push(entry);
    return () => {
      const i = subscribers.indexOf(entry);
      if (i >= 0) subscribers.splice(i, 1);
      unsubscribe();
    };
  });

  const store = { get, set, remove, subscribe } as unknown as HostStore;

  // Always present. A stub host WITHOUT a session is not a lesser stub, it is
  // an impossible one — the shell's type has no such value — so the helper
  // cannot produce it either.
  const accessToken = vi.fn(async () => 'stub-access-token');
  const signOut = options.signOut === false ? null : vi.fn(async () => {});
  const onUnauthorized = vi.fn();
  const authStateSubscribers = new Set<(user: HostUser | null) => void>();
  const subscribeAuthState = vi.fn((onChange: (user: HostUser | null) => void) => {
    authStateSubscribers.add(onChange);
    return () => authStateSubscribers.delete(onChange);
  });
  const session: HostSession = {
    user: {
      id: 'stub-user',
      username: 'stub.operator',
      displayName: 'Stub Operator',
      email: 'stub.operator@example.invalid',
      roles: options.roles ?? ['user'],
    },
    accessToken,
    signOut,
    onUnauthorized,
    subscribeAuthState,
  };

  const apiUrl = vi.fn(async () => 'http://localhost:8090');
  const dashboardUrl = vi.fn(async () => 'http://localhost:3333');
  const endpointSubscribers: Array<() => void> = [];
  const endpoints = {
    apiUrl,
    dashboardUrl,
    subscribe: vi.fn((onChange: () => void) => {
      endpointSubscribers.push(onChange);
      return () => {
        const i = endpointSubscribers.indexOf(onChange);
        if (i >= 0) endpointSubscribers.splice(i, 1);
      };
    }),
  };

  const dashboard = vi.fn(async (_path: string) => {});
  const settings = options.settings === false ? null : vi.fn(async () => {});

  const capture =
    options.pageCapture === false
      ? null
      : vi.fn(async () => ({ content: 'captured page text', url: 'https://grafana.example/d/1' }));
  const pageCapture: HostPageCapture =
    capture === null
      ? { supported: false, reason: STUB_CAPTURE_REASON, installUrl: STUB_INSTALL_URL }
      : { supported: true, capture };

  return {
    host: { store, endpoints, navigation: { dashboard, settings }, pageCapture, session },
    store,
    get,
    set,
    remove,
    subscribe,
    unsubscribe,
    endpoints,
    apiUrl,
    dashboardUrl,
    /** Tell every endpoint subscriber the configured URL changed. */
    endpointsChanged: () => { for (const fn of [...endpointSubscribers]) fn(); },
    dashboard,
    settings,
    capture,
    signOut,
    accessToken,
    onUnauthorized,
    subscribeAuthState,
    /** What the host reports when the identity changes somewhere else. */
    authStateChanged: (user) => {
      for (const fn of [...authStateSubscribers]) fn(user);
    },
    data,
    emit(changed) {
      // Same membership rule the extension adapter applies: a key being present
      // is the signal, not its value.
      for (const { keys, onChange } of [...subscribers]) {
        const hit: Record<string, StoredValue> = {};
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(changed, key)) hit[key] = changed[key];
        }
        if (Object.keys(hit).length > 0) onChange(hit);
      }
    },
  };
}

/** A `renderHook` / `render` wrapper that mounts `host` above the tree. */
export function hostWrapper(host: WiredHost) {
  return function HostWrapper({ children }: { children: React.ReactNode }) {
    return <HostAdapterProvider value={host}>{children}</HostAdapterProvider>;
  };
}
