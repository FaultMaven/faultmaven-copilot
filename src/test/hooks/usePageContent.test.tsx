import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageContent } from '../../shared/ui/hooks/usePageContent';

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const executeScript = vi.fn();
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://grafana.example/dashboard' }]),
      // Force the programmatic-injection fallback (the executeScript path).
      sendMessage: vi.fn().mockRejectedValue(new Error('no content script'))
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
});
