import { useEffect, useState } from 'react';
import {
  API_BASE_URL_KEY,
  DASHBOARD_URL_KEY,
  LEGACY_ENDPOINT_KEY,
  getApiUrl,
  getDashboardUrl,
} from '../../../config';
import { useHost } from '../../host';

export type EndpointKind = 'api' | 'dashboard';

/**
 * The configured API or Dashboard URL, live-updated when the endpoint config
 * changes (Options save / first-run).
 *
 * - 'api'       → getApiUrl()       — what the copilot talks to (header host indicator).
 * - 'dashboard' → getDashboardUrl() — the web app to open (Open Dashboard / report links).
 *
 * Use this rather than the backend-reported capabilities.dashboardUrl, which is
 * the server's own (localhost) view on a self-hosted deployment.
 */
/** The keys whose change means this hook's answer may have changed. */
const ENDPOINT_KEYS = [API_BASE_URL_KEY, DASHBOARD_URL_KEY, LEGACY_ENDPOINT_KEY];

export function useConfiguredEndpoint(kind: EndpointKind): string {
  const { store } = useHost();
  const [url, setUrl] = useState('');

  useEffect(() => {
    let active = true;
    const read = kind === 'api' ? getApiUrl : getDashboardUrl;
    const refresh = async () => {
      try {
        const next = await read();
        if (active) setUrl(next);
      } catch {
        if (active) setUrl('');
      }
    };
    refresh();

    // Any endpoint-config key change is cheap to re-read. The host decides what
    // "a change to one of these keys" means; a host where the endpoint cannot
    // change returns an unsubscribe and never calls back, so this hook needs no
    // branch on which host it is running in.
    const unsubscribe = store.subscribe(ENDPOINT_KEYS, refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [kind, store]);

  return url;
}
