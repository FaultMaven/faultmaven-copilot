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
import { render, screen, fireEvent } from '@testing-library/react';
import { INPUT_LIMITS } from '../../shared/ui/layouts/constants';

// Mock browser API from wxt
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query: vi.fn(), sendMessage: vi.fn() },
  },
}));

import { UnifiedInputBar } from '../../shared/ui/components/UnifiedInputBar';

describe('UnifiedInputBar — auto-promotion at line threshold', () => {
  const threshold = INPUT_LIMITS.DATA_MODE_LINE_THRESHOLD;

  let mockQuerySubmit: ReturnType<typeof vi.fn>;
  let mockTurnSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuerySubmit = vi.fn();
    mockTurnSubmit = vi.fn().mockResolvedValue({ success: true, message: '' });
  });

  function renderBar() {
    return render(
      <UnifiedInputBar
        onQuerySubmit={mockQuerySubmit}
        onTurnSubmit={mockTurnSubmit}
      />
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
