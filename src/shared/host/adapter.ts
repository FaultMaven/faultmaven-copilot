/**
 * The host boundary for the Copilot UI.
 *
 * `src/shared/ui` reaches the browser through 27 direct `browser.*` calls and,
 * transitively, through ~106 more in the modules it imports under `src/lib`.
 * Every one of those is a statement about the HOST — the extension — not about
 * the UI. This interface is that set of statements, named once, so a second
 * host (the Dashboard page) can answer them differently.
 *
 * Design rules, each of which a call site today violates:
 *
 * 1. NOTHING HERE IS OPTIONAL-BY-UNDEFINED. A capability a host cannot provide
 *    is modelled as a discriminated union with a reason the UI can render, not
 *    as a missing method the UI probes for. `typeof browser !== 'undefined'`
 *    (CollapsibleNavigation.tsx:185, :323) is a guard that silently does
 *    nothing in the host that needs the affordance most.
 *
 * 2. `session` IS NON-NULLABLE. That is what makes "the shared UI renders no
 *    sign-in in the web host" structural rather than a branch someone can
 *    forget: there is no adapter without a session, so the UI has no state in
 *    which it must decide whether to show `AuthScreen`. Authentication happens
 *    ABOVE this boundary, in each host's own entry point.
 *
 * 3. THE UI NEVER HOLDS A REFRESH TOKEN. It asks for an access token and the
 *    host answers. Two independent token refreshers in one page rotate the
 *    same single-use refresh token against each other; the two that exist
 *    today do not even share a Web Lock name (`faultmaven-token-refresh` here,
 *    `fm-auth-refresh` in the Dashboard), so they would not exclude each other.
 *
 * This file declares the contract only. It is not wired into the extension:
 * doing that is the migration, and it happens one call site at a time.
 */
import { createContext, useContext } from 'react';

/** Values a host key-value store round-trips. */
export type StoredValue = unknown;

/**
 * Per-user, per-host key-value storage.
 *
 * Extension: `browser.storage.local` (survives side-panel teardown, shared with
 * the background worker). Web: `localStorage` under a namespace prefix.
 *
 * `subscribe` exists because `useConfiguredEndpoint` needs it and because the
 * extension genuinely has two writers (background + panel). A host with one
 * writer returns a no-op unsubscribe; it does not omit the method.
 */
export interface HostStore {
  get(keys: string[]): Promise<Record<string, StoredValue>>;
  set(items: Record<string, StoredValue>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Returns an unsubscribe. Fires only for keys in `keys`. */
  subscribe(keys: string[], onChange: (changed: Record<string, StoredValue>) => void): () => void;
}

/**
 * Where the backend is, and whether that can change under the UI.
 *
 * Extension: user-configured on the Options page, so it changes at runtime and
 * `subscribe` fires. Web: the origin that served the app already decided, so
 * `subscribe` never fires — but it is still called, and still returns an
 * unsubscribe, so the calling hook needs no host branch.
 */
export interface HostEndpoints {
  apiUrl(): Promise<string>;
  dashboardUrl(): Promise<string>;
  subscribe(onChange: () => void): () => void;
}

/**
 * A navigation the UI can ask for but must not perform itself.
 *
 * `dashboard(path)` is `browser.tabs.query`/`update`/`create` in the extension
 * (SidePanelApp.tsx:313-324: focus an existing dashboard tab, else open one)
 * and a router push in the web host, which IS the dashboard.
 */
export interface HostNavigation {
  dashboard(path: string): Promise<void>;
  external(url: string): Promise<void>;
  /**
   * `browser.runtime.openOptionsPage()` in the extension.
   *
   * `null` in a host with no settings page of its own — and `null`, not a
   * no-op, so the UI renders no dead "Open Settings" button. Three call sites
   * (SidePanelApp.tsx:260, CollapsibleNavigation.tsx:186, :324) currently
   * render the affordance unconditionally.
   */
  settings: (() => Promise<void>) | null;
}

/** The signed-in user, as the host knows them. */
export interface HostUser {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  roles: string[];
  organizationId?: string;
}

/**
 * An authenticated session, supplied BY the host.
 *
 * The UI never logs in, never stores a token, and never refreshes one. It asks
 * for a bearer token per request and the host — which owns the refresh lock,
 * the storage key and the rotation — answers.
 */
export interface HostSession {
  user: HostUser;
  /** A currently-valid access token. The host refreshes as needed. */
  accessToken(): Promise<string>;
  /**
   * `null` when the host owns sign-out (the Dashboard has its own account
   * menu). The UI then renders no sign-out of its own rather than a second
   * one that clears half the state.
   */
  signOut: (() => Promise<void>) | null;
}

/**
 * Page capture: the one capability the web host cannot provide.
 *
 * A union, not an optional method, because the issue's requirement is that the
 * affordance stays VISIBLE and explains itself. `supported: false` carries the
 * text and the install link the UI renders; there is no shape in which the UI
 * can render the button and have nothing to say when it is pressed.
 *
 * Extension: `tabs.query` + `permissions.contains`/`request` +
 * `scripting.executeScript` (usePageContent.ts:16, :102, :105, :115).
 */
export type HostPageCapture =
  | { supported: true; capture(): Promise<{ content: string; url: string }> }
  | { supported: false; reason: string; installUrl: string };

/**
 * Everything the Copilot UI needs from the environment it runs in.
 *
 * `kind` is for telemetry and copy, never for behaviour: a branch on `kind` is
 * a capability this interface failed to model, and the next host makes it
 * wrong. Branch on the capability.
 */
export interface HostAdapter {
  readonly kind: 'extension' | 'web';
  readonly store: HostStore;
  readonly endpoints: HostEndpoints;
  readonly navigation: HostNavigation;
  readonly session: HostSession;
  readonly pageCapture: HostPageCapture;
}

/**
 * No default. A `useHost()` that returns a stub when no provider is mounted is
 * the fail-open shape this boundary exists to remove: the UI would render, do
 * nothing, and stay green.
 */
const HostAdapterContext = createContext<HostAdapter | null>(null);

export const HostAdapterProvider = HostAdapterContext.Provider;

export function useHost(): HostAdapter {
  const host = useContext(HostAdapterContext);
  if (!host) {
    throw new Error(
      'No HostAdapter in context. Mount <HostAdapterProvider value={…}> above the Copilot UI.',
    );
  }
  return host;
}
