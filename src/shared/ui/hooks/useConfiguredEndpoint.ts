import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getApiUrl, getDashboardUrl } from '../../../config';

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
export function useConfiguredEndpoint(kind: EndpointKind): string {
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

    const onChange = (changes: any, area: string) => {
      // Any endpoint-config key change is cheap to re-read.
      if (area === 'local' && (changes.apiBaseUrl || changes.dashboardUrl || changes.apiEndpoint)) {
        refresh();
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChange);
    };
  }, [kind]);

  return url;
}
