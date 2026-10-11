/**
 * UnifiedInputBar — what goes in as a message and what goes in as data (#327).
 *
 * Chat messages are claims; only submitted data (uploaded or pasted, stored as
 * files) is evidence, and the user declares which is which. A multi-line paste
 * EVENT into the chat box goes to the textpad (Paste data) and leaves what the
 * user typed in the box; both go out in one turn. Typing never switches modes.
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

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');
const box = () => screen.getByLabelText(/Type your message/i) as HTMLTextAreaElement;
const send = () => fireEvent.click(screen.getByRole('button', { name: /send/i }));
/** A paste event into the chat box; false when the component took it (preventDefault). */
const paste = (text: string, target: HTMLElement = box()) =>
  fireEvent.paste(target, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
const putBack = () => screen.getByRole('button', { name: /put back in message/i });
const textpad = () => screen.getByLabelText('Paste data content');

describe('UnifiedInputBar — a multi-line paste goes to the textpad (#327)', () => {
  const threshold = INPUT_LIMITS.PASTE_TO_TEXTPAD_LINE_THRESHOLD;

  let mockQuerySubmit: any;
  let mockTurnSubmit: any;

  beforeEach(() => {
    mockQuerySubmit = vi.fn();
    mockTurnSubmit = vi.fn().mockResolvedValue({ success: true, message: '', sent: true });
  });

  function renderBar(props: Record<string, unknown> = {}) {
    // Capture now comes from the host, not a prop.
    return render(
      <UnifiedInputBar
        onQuerySubmit={mockQuerySubmit}
        onTurnSubmit={mockTurnSubmit}
        {...props}
      />,
      { wrapper: hostWrapper(createStubHost().host) }
    );
  }

  const stageFile = async () => {
    const file = new File(['boom'], 'app.log', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('File input'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('app.log')).toBeInTheDocument());
    return file;
  };

  it('defaults to three lines', () => {
    expect(threshold).toBe(3);
  });

  it('moves the paste to the textpad, keeps the typed words, and sends both in one turn', async () => {
    renderBar();
    fireEvent.change(box(), { target: { value: 'this started after the deploy, why?' } });
    const output = lines(threshold, 'ERROR');

    expect(paste(output)).toBe(false);

    expect(box()).toHaveValue('this started after the deploy, why?');
    expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
    send();
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
    const payload = mockTurnSubmit.mock.calls[0][0];
    expect(payload.query).toBe('this started after the deploy, why?');
    expect(payload.queryIsGenerated).toBeUndefined();
    expect(payload.pastedContent).toBe(output);
    expect(payload.inputType).toBe('paste');
    expect(mockQuerySubmit).not.toHaveBeenCalled();
  });

  it.each([1, 2])('leaves a %i-line paste in the box', (n) => {
    renderBar();
    expect(paste(lines(n))).toBe(true);
    expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /put back in message/i })).not.toBeInTheDocument();
  });

  it('counts lines without the blank lines around the paste', () => {
    renderBar();
    expect(paste('\n\nfirst\nsecond\n\n')).toBe(true);
    expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
  });

  it('typing past any line count sends the text as the question, unchanged', async () => {
    renderBar();
    const typed = lines(150);
    fireEvent.change(box(), { target: { value: typed } });
    expect(screen.queryByText(/Large text detected/i)).not.toBeInTheDocument();
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(mockQuerySubmit).toHaveBeenCalledTimes(1));
    expect(mockQuerySubmit).toHaveBeenCalledWith(typed);
    expect(mockTurnSubmit).not.toHaveBeenCalled();
  });

  it('keeps the leading indentation of the first line; strips only blank edge lines', async () => {
    renderBar();
    const yaml = '  spec:\n    replicas: 3\n    image: api:1.2';
    paste(`\n   \n${yaml}\n\n`);
    send();
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
    expect(mockTurnSubmit.mock.calls[0][0].pastedContent).toBe(yaml);
  });

  it('sends a paste-only turn with a generated question', async () => {
    renderBar();
    paste(lines(threshold));
    send();
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
    const payload = mockTurnSubmit.mock.calls[0][0];
    expect(payload.pastedContent).toBe(lines(threshold));
    expect(payload.queryIsGenerated).toBe(true);
  });

  describe('undo', () => {
    it('puts the paste back at the caret where it was pasted', () => {
      renderBar();
      fireEvent.change(box(), { target: { value: 'before after' } });
      box().setSelectionRange(7, 7);
      paste('one\ntwo\nthree');
      fireEvent.click(putBack());
      expect(box()).toHaveValue('before one\ntwo\nthreeafter');
      expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /put back in message/i })).not.toBeInTheDocument();
    });

    it('replaces the selection, as the paste would have', () => {
      renderBar();
      fireEvent.change(box(), { target: { value: 'keep DROP keep' } });
      box().setSelectionRange(5, 9);
      paste('a\nb\nc');
      fireEvent.click(putBack());
      expect(box()).toHaveValue('keep a\nb\nc keep');
    });

    it('appends when the box changed after the paste', () => {
      renderBar();
      fireEvent.change(box(), { target: { value: 'first' } });
      paste('a\nb\nc');
      fireEvent.change(box(), { target: { value: 'first, then more' } });
      fireEvent.click(putBack());
      expect(box()).toHaveValue('first, then more\na\nb\nc');
    });

    it('is offered only while the textpad still holds what the paste put there', () => {
      renderBar();
      paste(lines(threshold));
      expect(putBack()).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /remove pasted data/i }));
      expect(screen.queryByRole('button', { name: /put back in message/i })).not.toBeInTheDocument();
    });
  });

  it('a second multi-line paste is added after the first; undo takes back only the second', async () => {
    renderBar();
    paste(lines(3, 'first'));
    paste(lines(3, 'second'));
    expect(screen.getByText(/6 lines/)).toBeInTheDocument();
    fireEvent.click(putBack());
    expect(box()).toHaveValue(lines(3, 'second'));
    send();
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
    const payload = mockTurnSubmit.mock.calls[0][0];
    expect(payload.pastedContent).toBe(lines(3, 'first'));
    expect(payload.query).toBe(lines(3, 'second'));
  });

  describe('a file and a paste go in one turn', () => {
    it('a multi-line paste with a file staged keeps the file; both are sent, the paste typed as a paste', async () => {
      renderBar();
      const file = await stageFile();
      fireEvent.change(box(), { target: { value: 'why?' } });

      expect(paste(lines(threshold))).toBe(false);

      expect(screen.getByText('app.log')).toBeInTheDocument();
      expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
      expect(screen.getByRole('status')).not.toHaveTextContent(/replacing/);
      send();
      await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
      const payload = mockTurnSubmit.mock.calls[0][0];
      expect(payload.query).toBe('why?');
      expect(payload.files).toEqual([file]);
      expect(payload.pastedContent).toBe(lines(threshold));
      expect(payload.inputType).toBe('paste');
    });

    it('undo puts the paste back and leaves the file staged', async () => {
      renderBar();
      const file = await stageFile();
      paste(lines(threshold));
      fireEvent.click(putBack());
      expect(screen.getByText('app.log')).toBeInTheDocument();
      expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
      expect(box()).toHaveValue(lines(threshold));
      send();
      await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
      const payload = mockTurnSubmit.mock.calls[0][0];
      expect(payload.files).toEqual([file]);
      expect(payload.pastedContent).toBeUndefined();
      expect(payload.inputType).toBe('file');
    });

    it('picking a file with a paste staged keeps the paste', async () => {
      renderBar();
      paste(lines(threshold));
      const file = await stageFile();
      expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
      send();
      await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
      const payload = mockTurnSubmit.mock.calls[0][0];
      expect(payload.files).toEqual([file]);
      expect(payload.pastedContent).toBe(lines(threshold));
      expect(payload.inputType).toBe('paste');
    });

    it('Done in the textpad keeps a staged file', async () => {
      renderBar();
      const file = await stageFile();
      fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
      fireEvent.change(textpad(), { target: { value: 'ERROR x' } });
      fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
      expect(screen.getByText('app.log')).toBeInTheDocument();
      send();
      await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
      expect(mockTurnSubmit.mock.calls[0][0]).toMatchObject({ files: [file], pastedContent: 'ERROR x', inputType: 'paste' });
    });

    it('each is removable on its own', async () => {
      renderBar();
      await stageFile();
      paste(lines(threshold));
      fireEvent.click(screen.getByRole('button', { name: /remove file/i }));
      expect(screen.queryByText('app.log')).not.toBeInTheDocument();
      expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
    });
  });

  describe('a captured page and a paste cannot share a turn (both travel in pasted_content)', () => {
    const capturePage = async () => {
      fireEvent.click(screen.getByRole('button', { name: /analyze current page/i }));
      await waitFor(() => expect(screen.getByText(/Captured: https:\/\/grafana/)).toBeInTheDocument());
    };

    it('the paste replaces the page, says so, and undo restores the page', async () => {
      renderBar();
      await capturePage();
      expect(paste(lines(threshold))).toBe(false);
      expect(screen.queryByText(/Captured: https:\/\/grafana/)).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/replacing the captured page/);
      fireEvent.click(putBack());
      expect(screen.getByText(/Captured: https:\/\/grafana/)).toBeInTheDocument();
      expect(box()).toHaveValue(lines(threshold));
    });

    it('Send with a page staged beside the open textpad sends nothing and asks the user to choose', async () => {
      renderBar();
      await capturePage();
      fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
      fireEvent.change(textpad(), { target: { value: 'ERROR x' } });
      send();
      expect(await screen.findByRole('alert')).toHaveTextContent(/captured page/);
      expect(mockTurnSubmit).not.toHaveBeenCalled();
      expect(textpad()).toHaveValue('ERROR x');
    });
  });

  it('with attachments disabled (a closed case), the paste goes in the box', () => {
    renderBar({ disableAttachments: true });
    expect(paste(lines(10))).toBe(true);
    expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
  });

  describe('with the textpad open', () => {
    it('adds the paste to the textpad, and Send carries it without Done', async () => {
      renderBar();
      fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
      fireEvent.change(textpad(), { target: { value: 'typed data' } });
      fireEvent.change(box(), { target: { value: 'why?' } });
      expect(paste(lines(threshold))).toBe(false);
      expect(textpad()).toHaveValue(`typed data\n${lines(threshold)}`);
      send();
      await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
      const payload = mockTurnSubmit.mock.calls[0][0];
      expect(payload.query).toBe('why?');
      expect(payload.pastedContent).toBe(`typed data\n${lines(threshold)}`);
    });

    it('undo takes the paste back out of the open textpad', () => {
      renderBar();
      fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
      fireEvent.change(textpad(), { target: { value: 'typed data' } });
      paste(lines(threshold));
      fireEvent.click(putBack());
      expect(textpad()).toHaveValue('typed data');
      expect(box()).toHaveValue(lines(threshold));
    });

    it('Send with a file staged beside the open textpad carries both', async () => {
      renderBar();
      const file = await stageFile();
      fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
      fireEvent.change(textpad(), { target: { value: 'ERROR x' } });
      send();
      await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
      expect(mockTurnSubmit.mock.calls[0][0]).toMatchObject({ files: [file], pastedContent: 'ERROR x', inputType: 'paste' });
    });
  });

  it('the Done button keeps the first line\'s indentation', async () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
    fireEvent.change(textpad(), { target: { value: '\n  key: v\n  other: w\n\n' } });
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    send();
    await waitFor(() => expect(mockTurnSubmit).toHaveBeenCalledTimes(1));
    expect(mockTurnSubmit.mock.calls[0][0].pastedContent).toBe('  key: v\n  other: w');
  });

  it('says where data goes, beside the Paste button', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /paste data/i })).toHaveAttribute(
      'title',
      expect.stringMatching(/logs.*output.*config/i),
    );
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
  const threshold = INPUT_LIMITS.PASTE_TO_TEXTPAD_LINE_THRESHOLD;
  const renderBar = (props: Record<string, unknown> = {}, query: any = vi.fn().mockResolvedValue({ sent: true }), turn: any = vi.fn().mockResolvedValue({ success: true, message: '', sent: true })) => {
    const view = render(
      <UnifiedInputBar onQuerySubmit={query} onTurnSubmit={turn} {...props} />,
      { wrapper: hostWrapper(createStubHost().host) },
    );
    return { ...view, query, turn };
  };
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

  it('long text goes as an ordinary question, not as pasted data', async () => {
    const { query, turn } = renderBar({ disableAttachments: true });
    fireEvent.change(box(), { target: { value: lines(105) } });
    send();
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query.mock.calls[0][0]).toContain('line 1');
    expect(turn).not.toHaveBeenCalled();
  });

  it('a paste moved to the textpad before the case turned terminal is not sent; put back, it goes as the question', async () => {
    const q = vi.fn(); const t = vi.fn();
    const host = hostWrapper(createStubHost().host);
    const { rerender } = render(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} />, { wrapper: host });
    paste(lines(threshold));
    rerender(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} disableAttachments />);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(/closed case/i);
    expect(t).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
    fireEvent.click(putBack());
    send();
    await waitFor(() => expect(q).toHaveBeenCalledTimes(1));
    expect(q).toHaveBeenCalledWith(lines(threshold));
    expect(t).not.toHaveBeenCalled();
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

  it('a drag over a closed case shows no copy cursor', () => {
    renderBar({ disableAttachments: true });
    const dt = { types: ['Files'], files: [], dropEffect: '' };
    fireEvent.dragOver(box(), { dataTransfer: dt });
    expect(dt.dropEffect).toBe('none');
  });

  it('a pasted block staged before the case turned terminal is not sent; it stays', async () => {
    const q = vi.fn(); const t = vi.fn();
    const { rerender } = render(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} />, { wrapper: hostWrapper(createStubHost().host) });
    fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
    fireEvent.change(screen.getByLabelText('Paste data content'), { target: { value: 'ERROR boom' } });
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    await waitFor(() => expect(screen.getByText(/Pasted context/)).toBeInTheDocument());
    rerender(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} disableAttachments />);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(/closed case/i);
    expect(t).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
    expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
  });

  it('a captured page staged before the case turned terminal is not sent; it stays', async () => {
    const q = vi.fn(); const t = vi.fn();
    const { rerender } = render(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} />, { wrapper: hostWrapper(createStubHost().host) });
    fireEvent.click(screen.getByRole('button', { name: /analyze current page/i }));
    await waitFor(() => expect(screen.getByText(/Captured: https:\/\/grafana/)).toBeInTheDocument());
    rerender(<UnifiedInputBar onQuerySubmit={q} onTurnSubmit={t} disableAttachments />);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(/closed case/i);
    expect(t).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
    expect(screen.getByText(/Captured: https:\/\/grafana/)).toBeInTheDocument();
  });

  describe('a refused turn', () => {
    const stagePaste = async (turn: any) => {
      renderBar({}, vi.fn(), turn);
      fireEvent.change(box(), { target: { value: 'why?' } });
      paste(lines(threshold));
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
      send();
      await waitFor(() => expect(turn).toHaveBeenCalledTimes(1));
    };

    it('keeps the pasted data and the typed words', async () => {
      const turn = vi.fn().mockResolvedValue({ success: false, message: 'closed', sent: true, refused: true });
      await stagePaste(turn);
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
      expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
      expect(box()).toHaveValue('why?');
      // The undo still works: on a closed case it is how the text goes out as a question.
      expect(putBack()).toBeInTheDocument();
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
