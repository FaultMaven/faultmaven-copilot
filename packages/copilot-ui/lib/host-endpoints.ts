/**
 * Where the backend is, for the modules that cannot ask React for it.
 *
 * The same shape as `host-store.ts`: the host installs its answer once per
 * context and the plain modules — the credential stack, the capabilities probe
 * — read it. They run in background continuations and in effects, so they
 * cannot reach `useHost()`.
 *
 * WHY THIS IS NOT `ApiTransport.baseUrl()`. The transport is SESSION-SCOPED:
 * the extension installs it when a session comes into existence, and reading it
 * earlier throws by design, because a request issued without a bearer is the
 * failure that file exists to prevent. But the API URL is needed BEFORE any
 * session exists — to ask the deployment which auth mode it runs, to exchange
 * an authorization code, to sign in, to fetch backend capabilities. Those are
 * host questions, not session questions, so they come from the host's
 * capabilities, which every context installs at entry.
 *
 * So the rule is: a request the shared UI issues on behalf of a session takes
 * its base URL from the transport; anything that can run before a session
 * exists takes it from here. In the extension both resolve to the same
 * configured endpoint.
 *
 * Reads before installation THROW. A silent fallback to the Cloud default is
 * exactly the failure this replaces: a self-hosted install whose background
 * worker quietly talked to `api.faultmaven.ai` and reported nothing.
 */
import type { HostEndpoints } from '../shared/host';

let endpoints: HostEndpoints | null = null;

/** Install the host's endpoints. Called once per context, at its entry point. */
export function setHostEndpoints(next: HostEndpoints): void {
  endpoints = next;
}

/** Test seam: drop the installed endpoints so a leak between tests is loud. */
export function clearHostEndpoints(): void {
  endpoints = null;
}

export function getHostEndpoints(): HostEndpoints {
  if (!endpoints) {
    throw new Error(
      'No HostEndpoints installed. The host must call setHostEndpoints() before anything resolves a backend URL.',
    );
  }
  return endpoints;
}
