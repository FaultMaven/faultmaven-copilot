/**
 * UnifiedInputBar — auto-promotion behavior tests.
 *
 * Covers the line-count-based mode switch in UnifiedInputBar.tsx:134-142:
 * when the user pastes/types content with >= DATA_MODE_LINE_THRESHOLD lines
 * (default 100), the component flips from 'question' mode to 'data' mode,
 * shows a warning banner, and routes submission via onTurnSubmit with
 * inputType='paste' instead of onQuerySubmit.
 *
 * This is the "user pasted into chat textbox" path described in the
 * text-paste pipeline review — the agent never sees a "is this data or a
 * question?" decision; the frontend made it via line count.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { INPUT_LIMITS } from '@faultmaven/copilot-ui/shared/ui/layouts/constants';
import { createStubHost, hostWrapper } from '../support/host';

// Mock browser API from wxt
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query: vi.fn(), sendMessage: vi.fn() },
  },
}));

import { UnifiedInputBar } from '@faultmaven/copilot-ui/shared/ui/components/UnifiedInputBar';

describe('UnifiedInputBar — auto-promotion at line threshold', () => {
  const threshold = INPUT_LIMITS.DATA_MODE_LINE_THRESHOLD;

  let mockQuerySubmit: any;
  let mockTurnSubmit: any;

  beforeEach(() => {
    mockQuerySubmit = vi.fn();
    mockTurnSubmit = vi.fn().mockResolvedValue({ success: true, message: '', sent: true });
  });

  function renderBar() {
    // Capture now comes from the host, not a prop.
    return render(
      <UnifiedInputBar
        onQuerySubmit={mockQuerySubmit}
        onTurnSubmit={mockTurnSubmit}
      />,
      { wrapper: hostWrapper(createStubHost().host) }
    );
  }

  /**
   * Helper: build a multi-line string with `lines` lines.
   * Each line carries enough content that the mode-detection useEffect can't
   * accidentally short-circuit on empty lines.
   */
  function multiline(lines: number): string {
    return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
  }

  it('stays in question mode and shows no warning banner under the threshold', () => {
    renderBar();
    const textarea = screen.getByLabelText(/Type your message/i);

    // Paste content well below the threshold (e.g., 5 lines)
    fireEvent.change(textarea, { target: { value: multiline(5) } });

    // No "Large text detected" banner
    expect(
      screen.queryByText(/Large text detected/i),
    ).not.toBeInTheDocument();
  });

  it('auto-promotes to data mode at the threshold and shows the banner', () => {
    renderBar();
    const textarea = screen.getByLabelText(/Type your message/i);

    // Paste content at the threshold — should flip to data mode
    fireEvent.change(textarea, { target: { value: multiline(threshold) } });

    expect(
      screen.getByText(/Large text detected — will be processed as data/i),
    ).toBeInTheDocument();
  });

  it('routes submission as pasted_content with inputType=paste in data mode', async () => {
    renderBar();
    const textarea = screen.getByLabelText(/Type your message/i);

    // Auto-promote
    const longContent = multiline(threshold + 10);
    fireEvent.change(textarea, { target: { value: longContent } });

    // Submit via the Send button (Enter is suppressed in data mode)
    const sendButton = screen.getByRole('button', { name: /send|submit/i });
    fireEvent.click(sendButton);

    // Wait one microtask for handleSubmit's async path
    await Promise.resolve();

    // onQuerySubmit must NOT be called — data mode goes through onTurnSubmit
    expect(mockQuerySubmit).not.toHaveBeenCalled();

    // onTurnSubmit must be called with the textarea content as pastedContent
    expect(mockTurnSubmit).toHaveBeenCalledTimes(1);
    const payload = mockTurnSubmit.mock.calls[0][0];
    expect(payload.pastedContent).toBe(longContent);
    expect(payload.inputType).toBe('paste');
    // Data mode auto-generates a query when there's no separate user question
    expect(payload.query).toBeTruthy();
    // No file or sourceUrl when the source is the textarea paste
    expect(payload.files).toBeUndefined();
    expect(payload.sourceUrl).toBeUndefined();
  });

  it('reverts to question mode when content shrinks back below the threshold', () => {
    renderBar();
    const textarea = screen.getByLabelText(/Type your message/i);

    // Auto-promote
    fireEvent.change(textarea, { target: { value: multiline(threshold + 5) } });
    expect(
      screen.getByText(/Large text detected/i),
    ).toBeInTheDocument();

    // Shrink content well below threshold
    fireEvent.change(textarea, { target: { value: multiline(3) } });

    expect(
      screen.queryByText(/Large text detected/i),
    ).not.toBeInTheDocument();
  });

  it('submits the vetted URL returned by the capture, never a re-queried tab URL', async () => {
    // The hook returns the fragment-stripped URL of the tab it injected into.
    // Poison tabs.query: if the component re-queries the active tab (the old
    // TOCTOU — the user can switch tabs while the capture's permission prompt
    // is open), it would pick up a different page's URL with a secret in the
    // fragment.
    const { browser } = await import('wxt/browser');
    (browser.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 2, url: 'https://other-tab.example.com/#access_token=SECRET123' },
    ]);
    const stub = createStubHost();
    stub.capture!.mockResolvedValue({
      content: 'captured page text',
      url: 'https://app.example.com/dashboard?range=1h',
    });

    render(
      <UnifiedInputBar
        onQuerySubmit={mockQuerySubmit}
        onTurnSubmit={mockTurnSubmit}
      />,
      { wrapper: hostWrapper(stub.host) }
    );

    fireEvent.click(screen.getByRole('button', { name: /Analyze current page/i }));
    // The staged-page chip renders once capture completes and the URL is set
    await waitFor(() => {
      expect(screen.getByText(/app\.example\.com/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
    const payload = mockTurnSubmit.mock.calls[0][0];
    expect(payload.inputType).toBe('page_capture');
    expect(payload.sourceUrl).toBe('https://app.example.com/dashboard?range=1h');
    expect(payload.sourceUrl).not.toContain('SECRET123');
    expect(payload.pastedContent).not.toContain('SECRET123');
    // The component must not have consulted the active tab at all.
    expect(browser.tabs.query).not.toHaveBeenCalled();
  });

  it('routes a normal short query via onQuerySubmit, not the pasted_content path', async () => {
    renderBar();
    const textarea = screen.getByLabelText(/Type your message/i);

    // Type a regular short question
    fireEvent.change(textarea, { target: { value: 'why is my service down?' } });

    // Submit via Enter (allowed in question mode)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await Promise.resolve();

    // Question mode submission goes through onQuerySubmit
    expect(mockQuerySubmit).toHaveBeenCalledWith('why is my service down?');
    // Should NOT also fire the unified turn path
    expect(mockTurnSubmit).not.toHaveBeenCalled();
  });
});

describe('UnifiedInputBar — what stays staged when a submission fails (#312)', () => {
  const stage = async (mockTurnSubmit: any) => {
    render(
      <UnifiedInputBar onQuerySubmit={vi.fn()} onTurnSubmit={mockTurnSubmit} />,
      { wrapper: hostWrapper(createStubHost().host) }
    );
    const file = new File(['boom'], 'app.log', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('File input'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/Type your message/i), { target: { value: 'why?' } });
    await waitFor(() => expect(screen.getByText('app.log')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
  };

  it('keeps the file and the text when the submission never reached the server', async () => {
    const turn = vi.fn().mockResolvedValue({ success: false, message: 'Server error', sent: false });
    await stage(turn);
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
    expect(screen.getByText('app.log')).toBeInTheDocument();
    expect(screen.getByLabelText(/Type your message/i)).toHaveValue('why?');
  });

  it('clears everything on success', async () => {
    const turn = vi.fn().mockResolvedValue({ success: true, message: '', sent: true });
    await stage(turn);
    await waitFor(() => expect(screen.queryByText('app.log')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/Type your message/i)).toHaveValue('');
  });

  it('clears the file AND the text when a sent turn failed (it has its own Retry)', async () => {
    const turn = vi.fn().mockResolvedValue({ success: false, message: 'Internal error', sent: true });
    await stage(turn);
    await waitFor(() => expect(screen.queryByText('app.log')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/Type your message/i)).toHaveValue('');
  });

  describe('a query-only submission', () => {
    const renderQuery = (onQuerySubmit: any) => {
      render(
        <UnifiedInputBar onQuerySubmit={onQuerySubmit} onTurnSubmit={vi.fn()} />,
        { wrapper: hostWrapper(createStubHost().host) }
      );
      const box = screen.getByLabelText(/Type your message/i);
      fireEvent.change(box, { target: { value: 'why is it down?' } });
      fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
      return box;
    };

    it('puts the text back when it never reached the server', async () => {
      const box = renderQuery(vi.fn().mockResolvedValue({ sent: false }));
      await waitFor(() => expect(box).toHaveValue('why is it down?'));
    });

    it('does not restore the text when it was sent', async () => {
      const box = renderQuery(vi.fn().mockResolvedValue({ sent: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(box).toHaveValue('');
    });

    it('does not overwrite what the user typed in the meantime', async () => {
      let settle!: (v: { sent: boolean }) => void;
      const box = renderQuery(vi.fn().mockReturnValue(new Promise((r) => { settle = r; })));
      fireEvent.change(box, { target: { value: 'something else' } });
      settle({ sent: false });
      await Promise.resolve();
      await Promise.resolve();
      expect(box).toHaveValue('something else');
    });
  });
});

describe('UnifiedInputBar — a closed case sends nothing it will refuse (#318)', () => {
  const threshold = INPUT_LIMITS.DATA_MODE_LINE_THRESHOLD;
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
  const renderBar = (props: Record<string, unknown> = {}, query: any = vi.fn().mockResolvedValue({ sent: true }), turn: any = vi.fn().mockResolvedValue({ success: true, message: '', sent: true })) => {
    const view = render(
      <UnifiedInputBar onQuerySubmit={query} onTurnSubmit={turn} {...props} />,
      { wrapper: hostWrapper(createStubHost().host) },
    );
    return { ...view, query, turn };
  };
  const box = () => screen.getByLabelText(/Type your message/i);
  const send = () => fireEvent.click(screen.getByRole('button', { name: /send/i }));
  const dropOf = (file: File) => ({ dataTransfer: { types: ['Files'], files: [file], dropEffect: '' } });

  it('a drop stages nothing and shows no overlay when attachments are disabled', () => {
    renderBar({ disableAttachments: true });
    const file = new File(['x'], 'dropped.log', { type: 'text/plain' });
    fireEvent.dragEnter(box(), dropOf(file));
    expect(screen.queryByText(/drop file here/i)).not.toBeInTheDocument();
    fireEvent.drop(box(), dropOf(file));
    expect(screen.queryByText('dropped.log')).not.toBeInTheDocument();
  });

  it('contrast: the same drop stages the file when attachments are enabled', async () => {
    renderBar();
    const file = new File(['x'], 'dropped.log', { type: 'text/plain' });
    fireEvent.drop(box(), dropOf(file));
    await waitFor(() => expect(screen.getByText('dropped.log')).toBeInTheDocument());
  });

  it('100+ lines go as an ordinary question, not as pasted data', async () => {
    const { query, turn } = renderBar({ disableAttachments: true });
    fireEvent.change(box(), { target: { value: lines(threshold + 5) } });
    send();
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query.mock.calls[0][0]).toContain('line 1');
    expect(turn).not.toHaveBeenCalled();
  });

  it('a composer already in data mode leaves it, keeping the text, when the case turns terminal', async () => {
    const q = vi.fn(); const t = vi.fn();
    const host = hostWrapper(createStubHost().host);
    const { rerender } = render(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} />, { wrapper: host });
    fireEvent.change(box(), { target: { value: lines(threshold + 5) } });
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    rerender(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} disableAttachments />);
    send();
    await waitFor(() => expect(q).toHaveBeenCalledTimes(1));
    expect(t).not.toHaveBeenCalled();
    expect(box()).toHaveValue('');
  });

  it('an attachment staged before the case turned terminal is not sent; the content stays', async () => {
    const q = vi.fn(); const t = vi.fn();
    const host = hostWrapper(createStubHost().host);
    const { rerender } = render(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} />, { wrapper: host });
    const file = new File(['x'], 'app.log', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('File input'), { target: { files: [file] } });
    fireEvent.change(box(), { target: { value: 'why?' } });
    await waitFor(() => expect(screen.getByText('app.log')).toBeInTheDocument());
    rerender(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} disableAttachments />);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(/closed case/i);
    expect(q).not.toHaveBeenCalled();
    expect(t).not.toHaveBeenCalled();
    expect(screen.getByText('app.log')).toBeInTheDocument();
    expect(box()).toHaveValue('why?');
  });

  describe('a refused turn', () => {
    const stagePaste = async (turn: any) => {
      renderBar({}, vi.fn(), turn);
      fireEvent.change(box(), { target: { value: lines(threshold + 5) } });
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
      send();
      await waitFor(() => expect(turn).toHaveBeenCalledTimes(1));
    };

    it('keeps the pasted text', async () => {
      const turn = vi.fn().mockResolvedValue({ success: false, message: 'closed', sent: true, refused: true });
      await stagePaste(turn);
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
      expect((box() as HTMLTextAreaElement).value).toContain(`line ${threshold + 5}`);
    });

    it('keeps a staged file too', async () => {
      const turn = vi.fn().mockResolvedValue({ success: false, message: 'closed', sent: true, refused: true });
      renderBar({}, vi.fn(), turn);
      const file = new File(['x'], 'app.log', { type: 'text/plain' });
      fireEvent.change(screen.getByLabelText('File input'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByText('app.log')).toBeInTheDocument());
      send();
      await waitFor(() => expect(turn).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
      expect(screen.getByText('app.log')).toBeInTheDocument();
    });

    it('contrast: a sent, failed (not refused) turn still clears the box', async () => {
      const turn = vi.fn().mockResolvedValue({ success: false, message: 'boom', sent: true });
      await stagePaste(turn);
      await waitFor(() => expect(box()).toHaveValue(''));
    });
  });
});
