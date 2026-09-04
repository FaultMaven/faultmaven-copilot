/**
 * Hand the extension's capabilities to the modules that cannot ask for them.
 *
 * `src/lib` is full of plain modules — the credential stack, the Zustand store
 * and its slices, the capabilities probe, the session machinery — that read
 * state and resolve a backend URL from background continuations and effects.
 * They take those from module singletons (`host-store.ts`, `host-endpoints.ts`)
 * rather than from React context, which they cannot reach.
 *
 * EVERY EXTENSION CONTEXT MUST CALL THIS, and call it before anything else
 * runs. The side panel is not the only one: the background worker exchanges an
 * authorization code and refreshes tokens against the configured API URL, and
 * the options page reads and writes that URL and probes capabilities. A context
 * that skips this gets a throw from the first read — which is the point.
 * Silently answering with a default is how a self-hosted deployment's worker
 * would come to talk to FaultMaven Cloud with nothing in the log.
 *
 * Idempotent: installing the same singletons twice is a no-op.
 */
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { extensionStore } from './extension-store';
import { extensionEndpoints } from './endpoints';

export function installExtensionHostContext(): void {
  setHostStore(extensionStore);
  setHostEndpoints(extensionEndpoints);
}
