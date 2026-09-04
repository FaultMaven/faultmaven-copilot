/**
 * `@faultmaven/copilot-ui` — the Copilot UI, and the host contract it runs
 * against.
 *
 * WHAT A HOST NEEDS is everything below and nothing else. A host builds an
 * object satisfying `HostAdapter`, installs the two module singletons for the
 * plain modules that cannot read React context, and mounts `CopilotPanel` with
 * a session. There is no sign-in in this tree, no token, no `browser` — those
 * are the host's, and the types here are what say so.
 *
 * Deep subpaths resolve as well, because the extension in this repository
 * implements the host and needs the pieces the panel is assembled from. THIS
 * file is the supported surface for a second host; a Dashboard importing
 * `@faultmaven/copilot-ui/lib/...` is reaching past the contract.
 */

/** The shell. Takes a host whose session is non-nullable, so it renders no sign-in. */
export { default as CopilotPanel } from './shared/ui/CopilotPanel';
export { default } from './shared/ui/CopilotPanel';
export type { CopilotPanelProps, InitialCase, PanelChrome } from './shared/ui/CopilotPanel';

/** The transcript on its own, for a host embedding the conversation alone. */
export { ChatInterface } from './shared/ui/components/ChatInterface';

/** The host contract. */
export {
  HostAdapterProvider,
  useHost,
} from './shared/host';
export type {
  HostAdapter,
  HostCapabilities,
  HostEndpoints,
  HostNavigation,
  HostPageCapture,
  HostSession,
  HostStore,
  HostUser,
  StoredValue,
  WiredHost,
} from './shared/host';

/**
 * How a host hands its answers to the modules that cannot ask React for them —
 * the Zustand store, its slices, the session machinery, the credential-free
 * request path. Installed once per context, at the host's entry point, before
 * anything reads them; reads before installation throw, because a request that
 * silently went out unauthenticated or to the wrong origin is the failure this
 * boundary exists to prevent.
 */
export { setHostStore, getHostStore, clearHostStore } from './lib/host-store';
export { setHostEndpoints, getHostEndpoints, clearHostEndpoints } from './lib/host-endpoints';
export { setApiTransport, getApiTransport, clearApiTransport, hasApiTransport } from './lib/api/transport';
export type { ApiTransport } from './lib/api/transport';

/**
 * WHICH keys a FaultMaven session occupies — and therefore what ending one
 * clears.
 *
 * A host's transport has to answer `clearSession()`, and the only way to do
 * that without this is to restate the key list. Four copies of that list
 * already existed once and had drifted over whether `clientId` survives; the
 * answer is here, in the module that WRITES them, and a host delegates rather
 * than repeating it.
 */
export { clearPersistedSession } from './lib/api/session-core';
export type { ClearPersistedSessionOptions } from './lib/api/session-core';

/** The shapes a host renders or hands in. */
export type { UserCase, UserCaseState, Message, CaseDetail } from './types/case';
export type { OptimisticConversationItem, PendingOperation } from './lib/optimistic';
