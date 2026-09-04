/**
 * A stub WEB host, for the spike's proof.
 *
 * This is not the Dashboard's real adapter — it has no backend, no router and
 * no session refresh. It exists to answer one question: can the existing
 * Copilot UI render and be interacted with in a plain Vite page, with every
 * browser-extension API removed and an authenticated session handed in from
 * outside? Everything here is the smallest honest answer a real web host would
 * give to the same call.
 */
import type { HostAdapter, StoredValue } from '~/shared/host';

const NS = 'fm_playground_';

/** localStorage, namespaced — the shape a real web host would use. */
const listeners = new Set<(changed: Record<string, StoredValue>) => void>();

const store: HostAdapter['store'] = {
  async get(keys) {
    const out: Record<string, StoredValue> = {};
    for (const key of keys) {
      const raw = localStorage.getItem(NS + key);
      if (raw !== null) {
        try {
          out[key] = JSON.parse(raw);
        } catch {
          out[key] = raw;
        }
      }
    }
    return out;
  },
  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(NS + key, JSON.stringify(value));
    }
    for (const fn of listeners) fn(items);
  },
  async remove(keys) {
    for (const key of keys) localStorage.removeItem(NS + key);
  },
  subscribe(keys, onChange) {
    const filtered = (changed: Record<string, StoredValue>) => {
      const hit = Object.fromEntries(
        Object.entries(changed).filter(([k]) => keys.includes(k)),
      );
      if (Object.keys(hit).length > 0) onChange(hit);
    };
    listeners.add(filtered);
    return () => listeners.delete(filtered);
  },
};

/**
 * The web host is served BY the deployment it talks to, so the endpoint is the
 * origin and cannot change under the UI. `subscribe` therefore returns an
 * unsubscribe that unsubscribes from nothing — the caller still needs no
 * branch.
 */
const endpoints: HostAdapter['endpoints'] = {
  async apiUrl() {
    return window.location.origin;
  },
  async dashboardUrl() {
    return window.location.origin;
  },
  subscribe() {
    return () => {};
  },
};

const navigation: HostAdapter['navigation'] = {
  async dashboard(path) {
    // A real web host pushes onto its own router; it is already the Dashboard.
    window.history.pushState({}, '', path);
  },
  async external(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  // No extension options page in this host, and no Dashboard settings route in
  // the stub — so `null`, and the UI renders no dead affordance.
  settings: null,
};

/**
 * An ALREADY-AUTHENTICATED session, handed in by the host.
 *
 * The UI does not obtain this and cannot refresh it. That is the whole point of
 * the auth clause: with a non-nullable session on the adapter there is no state
 * in which the shared UI would render a sign-in screen.
 */
const session: HostAdapter['session'] = {
  user: {
    id: 'stub-user',
    username: 'stub.operator',
    displayName: 'Stub Operator',
    email: 'stub.operator@example.invalid',
    roles: ['user'],
  },
  async accessToken() {
    return 'stub-access-token';
  },
  // The Dashboard's own account menu owns sign-out; the panel renders none.
  signOut: null,
};

export const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/faultmaven-copilot/fghoagggojmkdopidfopijfnlmchjcng';

export const webHostAdapter: HostAdapter = {
  kind: 'web',
  store,
  endpoints,
  navigation,
  session,
  pageCapture: {
    supported: false,
    reason:
      'Capturing the page you are looking at needs the FaultMaven Copilot browser extension — a web page cannot read another tab. Install it to capture consoles and dashboards straight into a case.',
    installUrl: CHROME_WEB_STORE_URL,
  },
};
