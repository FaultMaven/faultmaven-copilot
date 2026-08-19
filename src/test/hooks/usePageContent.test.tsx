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
    // clearAllMocks resets calls, NOT implementations: the scheme block below
    // repoints tabs.query permanently, so each block must state the tab it
    // wants or the suite only passes in source order.
    (browser.tabs.query as any).mockResolvedValue([{ id: 1, url: 'https://grafana.example/dashboard' }]);
    // The extractor runs in the page context; simulate a page by invoking the
    // serialized func against jsdom's document/window.
    executeScript.mockImplementation(({ func }: any) => [{ result: func() }]);
    document.title = 'Prod Grafana';
    document.body.innerHTML = '<h1>Prod Grafana</h1><div><span>errors</span><span>5%</span></div>';
  });

  it('embeds the source URL in the captured content preamble', async () => {
    const { result } = renderHook(() => usePageContent());

    const { content } = await result.current.handlePageInject();

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
    const { content } = await result.current.handlePageInject();

    expect(content).not.toContain('access_token');
    expect(content).not.toContain('supersecret');
    // Origin + path + query are still present for traceability.
    expect(content).toContain('[source_url: https://grafana.example/dash?panel=1]');

    Object.defineProperty(window, 'location', { value: orig, writable: true, configurable: true });
  });

  it('returns the injected tab\'s URL, fragment-stripped, alongside the content', async () => {
    // The returned url is what the submit path sends as source_url — it must
    // come from the tab the extractor ran in and must never carry the hash.
    (browser.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'https://grafana.example/dash?panel=1#access_token=supersecret' }
    ]);
    const { result } = renderHook(() => usePageContent());

    const { url } = await result.current.handlePageInject();

    expect(url).toBe('https://grafana.example/dash?panel=1');
  });

  it('fails with the friendly message when tabs.query returns no tab', async () => {
    (browser.tabs.query as any).mockResolvedValue([]);
    const { result } = renderHook(() => usePageContent());

    // Not a TypeError from dereferencing undefined.
    await expect(result.current.handlePageInject()).rejects.toThrow('No active tab found');
  });
});

describe('usePageContent — schemes the browser will not inject into', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeScript.mockImplementation(({ func }: any) => [{ result: func() }]);
    (browser.tabs.query as any).mockResolvedValue([{ id: 1, url: 'https://grafana.example/dashboard' }]);
    (browser.permissions.contains as any).mockResolvedValue(true);
    (browser.permissions.request as any).mockResolvedValue(true);
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

  it.each([
    'https://chromewebstore.google.com/detail/faultmaven/abc',
    'https://chrome.google.com/webstore/detail/faultmaven/abc',
    'https://addons.mozilla.org/en-US/firefox/addon/faultmaven/',
  ])('refuses the extension gallery %s, which the browser blocks by policy', async (url) => {
    activeTabIs(url);
    const { result } = renderHook(() => usePageContent());

    await expect(result.current.handlePageInject()).rejects.toThrow(/extension gallery/);
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('captures a host that merely starts with the gallery name', async () => {
    // `chromewebstore.google.com.example.com` is an ordinary page. A prefix
    // match would refuse it with an explanation that is simply untrue.
    activeTabIs('https://chromewebstore.google.com.example.com/status');
    const { result } = renderHook(() => usePageContent());

    const { content } = await result.current.handlePageInject();
    expect(content).toContain('[captured_at:');
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blob:', 'blob:https://grafana.example/6c8f-1f2a-4c3d'],
    ['data:', 'data:text/html,<h1>report</h1>'],
    ['filesystem:', 'filesystem:https://grafana.example/temporary/report.html'],
    ['chrome-search:', 'chrome-search://local-ntp/local-ntp.html'],
  ])('refuses %s, which has no origin the browser can grant', async (_label, url) => {
    activeTabIs(url);
    const { result } = renderHook(() => usePageContent());

    // These used to reach the origin builder and produce a pattern like
    // `blob:///*`, so permissions.contains() threw the raw browser error.
    await expect(result.current.handlePageInject()).rejects.toThrow(
      /http:\/\/ and https:\/\/ pages only|browser internal pages/
    );
    expect(browser.permissions.contains).not.toHaveBeenCalled();
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

    const { content } = await result.current.handlePageInject();

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(content).toContain('[captured_at:');
  });
});
