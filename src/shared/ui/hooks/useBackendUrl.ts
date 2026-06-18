import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getApiUrl } from '../../../config';

/**
 * The configured API backend URL the copilot talks to, live-updated when the
 * endpoint changes (Options save / first-run). A side panel has no URL bar, so
 * this lets the UI surface which backend is in use.
 */
export function useBackendUrl(): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await getApiUrl();
        if (active) setUrl(next);
      } catch {
        if (active) setUrl('');
      }
    };
    refresh();

    const onChange = (changes: any, area: string) => {
      // apiBaseUrl is the explicit key; apiEndpoint is the legacy fallback.
      if (area === 'local' && (changes.apiBaseUrl || changes.apiEndpoint)) {
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
