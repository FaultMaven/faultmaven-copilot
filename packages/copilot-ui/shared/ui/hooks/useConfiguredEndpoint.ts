import { useEffect, useState } from 'react';
import { useHost } from '../../host';

export type EndpointKind = 'api' | 'dashboard';

/**
 * The configured API or Dashboard URL, live-updated when it changes.
 *
 * - 'api'       → what the copilot talks to (header host indicator).
 * - 'dashboard' → the web app to open (Open Dashboard / report links).
 *
 * Both come from the host, which is the only thing that knows. In the extension
 * they are a user's choice on the Options page, persisted and migrated from a
 * legacy key; in a web host the deployment that served the page decided, and
 * `subscribe` never fires. Neither of those facts belongs here.
 *
 * Use this rather than the backend-reported capabilities.dashboardUrl, which is
 * the server's own (localhost) view on a self-hosted deployment.
 */
export function useConfiguredEndpoint(kind: EndpointKind): string {
  const { endpoints } = useHost();
  const [url, setUrl] = useState('');

  useEffect(() => {
    let active = true;
    const read = kind === 'api' ? endpoints.apiUrl : endpoints.dashboardUrl;
    const refresh = async () => {
      try {
        const next = await read.call(endpoints);
        if (active) setUrl(next);
      } catch {
        if (active) setUrl('');
      }
    };
    refresh();

    const unsubscribe = endpoints.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [kind, endpoints]);

  return url;
}
