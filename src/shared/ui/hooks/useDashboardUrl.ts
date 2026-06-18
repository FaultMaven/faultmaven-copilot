import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getDashboardUrl } from '../../../config';

/**
 * The configured Dashboard URL (Options), live-updated when the endpoint
 * changes. Use this for "open dashboard" links rather than the backend-reported
 * capabilities.dashboardUrl — a self-hosted backend reports its own localhost
 * view, which is wrong from this browser's perspective.
 */
export function useDashboardUrl(): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await getDashboardUrl();
        if (active) setUrl(next);
      } catch {
        if (active) setUrl('');
      }
    };
    refresh();

    const onChange = (changes: any, area: string) => {
      if (area === 'local' && (changes.dashboardUrl || changes.apiEndpoint)) {
        refresh();
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChange);
    };
  }, []);

  return url;
}
