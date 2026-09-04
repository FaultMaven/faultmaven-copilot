/**
 * A backend for the proof, in about a hundred lines.
 *
 * The transcript proof never needed one — it hands `ChatInterface` its turns
 * directly. Mounting the whole `CopilotPanel` does: the panel mints a session,
 * asks for capabilities, lists cases and fetches a case's messages before it can
 * show anything. Those are the calls a real host's deployment answers, so the
 * proof answers them itself rather than pretending the panel works with none.
 *
 * It is a stub and says so: everything is in memory, nothing is persisted, and
 * the only case that exists is the one below. What it proves is the wiring —
 * that `initialCase` puts the user on the composer or on a named case's
 * transcript — not the backend.
 */
import type { ApiTransport } from '@faultmaven/copilot-ui';

export const STUB_CASE_ID = 'case_playground_0001';

const STUB_CASE = {
  case_id: STUB_CASE_ID,
  title: 'Pods evicted on worker-03 after a disk-pressure taint',
  state: 'investigating',
  created_at: new Date(Date.now() - 36 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
  description: 'Stub case. Nothing here reaches a real backend.',
  owner_id: 'stub-user',
  organization_id: 'stub-org',
  closure_reason: null,
  closed_at: null,
};

const STUB_MESSAGES = [
  {
    message_id: 'm1',
    role: 'user',
    content: 'Half the pods on worker-03 went Evicted about 20 minutes ago.',
    created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
  {
    message_id: 'm2',
    role: 'assistant',
    content:
      'Eviction on a single node points at a **node-local** resource, not the workload. ' +
      'Run `kubectl describe node worker-03` and read the Conditions and Taints blocks.',
    created_at: new Date(Date.now() - 19 * 60 * 1000).toISOString(),
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Answer the calls the panel makes at mount. Anything else gets an empty 200. */
export function installStubBackend(): void {
  const realFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    const path = url.pathname;

    // Anything that is not this stub's API — the page's own assets — is real.
    if (!path.startsWith('/api/v1/') && !path.startsWith('/v1/')) {
      return realFetch(input as RequestInfo, init);
    }

    if (path === '/v1/meta/capabilities') {
      return json({ dashboardUrl: window.location.origin, features: {} });
    }
    if (path === '/api/v1/sessions') {
      return json({
        session_id: 'stub-session',
        created_at: new Date().toISOString(),
        status: 'active',
        user_id: 'stub-user',
        session_type: 'troubleshooting',
        client_id: 'stub-client',
        session_resumed: false,
        message: 'Stub session',
      });
    }
    if (path === '/api/v1/cases') return json([STUB_CASE]);
    if (path === `/api/v1/cases/${STUB_CASE_ID}`) return json(STUB_CASE);
    if (path === `/api/v1/cases/${STUB_CASE_ID}/ui`) {
      return json({ case_id: STUB_CASE_ID, state: 'investigating', title: STUB_CASE.title });
    }
    if (path === `/api/v1/cases/${STUB_CASE_ID}/messages`) {
      return json({ messages: STUB_MESSAGES, total: STUB_MESSAGES.length, has_more: false });
    }

    return json({});
  };
}

/**
 * The transport a web host installs. Its `clearSession` DELEGATES rather than
 * naming the keys — which is the whole reason the package exports
 * `clearPersistedSession`.
 */
export function stubTransport(
  accessToken: () => Promise<string>,
  clearPersistedSession: () => Promise<void>,
): ApiTransport {
  let sessionId: string | null = null;
  return {
    baseUrl: async () => window.location.origin,
    accessToken,
    sessionId: async () => sessionId,
    clearSession: async () => {
      sessionId = null;
      await clearPersistedSession();
    },
    onUnauthorized: () => {},
  };
}
