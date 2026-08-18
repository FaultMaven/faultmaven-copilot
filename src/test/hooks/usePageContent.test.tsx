import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { browser } from 'wxt/browser';
import { usePageContent } from '../../shared/ui/hooks/usePageContent';

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const executeScript = vi.fn();
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://grafana.example/dashboard' }])
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(true)
    },
    scripting: {
      executeScript: (...args: any[]) => executeScript(...args)
    }
  }
}));

describe('usePageContent — capture provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The extractor runs in the page context; simulate a page by invoking the
    // serialized func against jsdom's document/window.
    executeScript.mockImplementation(({ func }: any) => [{ result: func() }]);
    document.title = 'Prod Grafana';
    document.body.innerHTML = '<h1>Prod Grafana</h1><div><span>errors</span><span>5%</span></div>';
  });

  it('embeds the source URL in the captured content preamble', async () => {
    const { result } = renderHook(() => usePageContent());

    const content = await result.current.handlePageInject();

    // Provenance line must be present and carry the page URL (jsdom location).
    expect(content).toMatch(/\[source_url: https?:\/\/[^\]]+\]/);
    expect(content).toContain('[captured_at:');
  });

  it('strips the URL fragment so tokens in the hash are not captured', async () => {
    // Simulate an OAuth-implicit / SPA hash carrying a secret.
    const orig = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: 'https://grafana.example/dash?panel=1#access_token=supersecret&state=abc' },
      writable: true,
      configurable: true
    });

    const { result } = renderHook(() => usePageContent());
    const content = await result.current.handlePageInject();

    expect(content).not.toContain('access_token');
    expect(content).not.toContain('supersecret');
    // Origin + path + query are still present for traceability.
    expect(content).toContain('[source_url: https://grafana.example/dash?panel=1]');

    Object.defineProperty(window, 'location', { value: orig, writable: true, configurable: true });
  });
});

describe('usePageContent — schemes the browser will not inject into', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeScript.mockImplementation(({ func }: any) => [{ result: func() }]);
  });

  const activeTabIs = (url: string) => {
    (browser.tabs.query as any).mockResolvedValue([{ id: 1, url }]);
  };

  it('refuses a file:// tab without asking for a permission Chrome cannot grant', async () => {
    activeTabIs('file:///home/user/docs/ops-dashboard.html');
    const { result } = renderHook(() => usePageContent());

    await expect(result.current.handlePageInject()).rejects.toThrow(/file:\/\//);

    // The old failure mode: requesting `file:///*` throws
    // "Only permissions specified in the manifest may be requested".
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('refuses the Web Store, which the browser blocks by policy', async () => {
    activeTabIs('https://chromewebstore.google.com/detail/faultmaven/abc');
    const { result } = renderHook(() => usePageContent());

    await expect(result.current.handlePageInject()).rejects.toThrow(/Web Store/);
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abcdef/options.html',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://grafana.example/dashboard',
    'about:blank',
  ])('refuses the browser-internal page %s', async (url) => {
    activeTabIs(url);
    const { result } = renderHook(() => usePageContent());

    await expect(result.current.handlePageInject()).rejects.toThrow(/browser internal pages/);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('still captures an ordinary https page', async () => {
    activeTabIs('https://grafana.example/dashboard');
    document.title = 'Prod Grafana';
    document.body.innerHTML = '<h1>Prod Grafana</h1><p>errors 5%</p>';
    const { result } = renderHook(() => usePageContent());

    const content = await result.current.handlePageInject();

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(content).toContain('[captured_at:');
  });
});
