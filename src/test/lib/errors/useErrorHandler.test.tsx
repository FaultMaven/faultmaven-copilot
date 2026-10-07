import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ErrorHandlerProvider, useErrorHandler } from '@faultmaven/copilot-ui/lib/errors/useErrorHandler';
import { DuplicateUploadNotice, RateLimitError } from '@faultmaven/copilot-ui/lib/errors/types';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => log
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ErrorHandlerProvider>{children}</ErrorHandlerProvider>
);

const statusError = (status: number, message = 'boom') => {
  const e: any = new Error(message);
  e.status = status;
  return e;
};

describe('useErrorHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // Regression: showError has empty deps (stable identity), so it must read the
  // live errors via a ref. Previously it closed over the first-render (empty)
  // `errors`, so aggregation never fired and duplicates stacked up.
  it('aggregates a duplicate error instead of stacking it', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    let firstId = '';
    let secondId = '';
    act(() => { firstId = result.current.showError(statusError(500, 'server down')); });
    act(() => { secondId = result.current.showError(statusError(500, 'server down')); });

    // Same category + title + message → aggregated: one visible error, same id.
    expect(secondId).toBe(firstId);
    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(1);
  });

  it('keeps distinct errors separate (does not over-aggregate)', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    act(() => { result.current.showError(statusError(408)); }); // TimeoutError
    act(() => { result.current.showError(statusError(403)); }); // PermissionError

    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(2);
  });

  // Regression: the unmount cleanup effect had deps [timeoutIds,
  // dismissalTimeouts], so it fired on every map change and cleared live
  // auto-dismiss timers as soon as a second one registered — the first error
  // then never auto-dismissed.
  it('auto-dismisses every timed error even when several are registered', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    // Two distinct toasts with positive durations (TimeoutError 10s, PermissionError 8s).
    act(() => { result.current.showError(statusError(408)); });
    act(() => { result.current.showError(statusError(403)); });
    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(2);

    // Advance past the longest duration + the 300ms removal animation.
    act(() => { vi.advanceTimersByTime(10_000 + 300); });

    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(0);
  });

  // `RateLimitError` signals "leave this up until the user closes it" by
  // emitting `duration: 0` for a wait too long to sit through. That contract
  // lives across a seam: the error sets 0, this hook decides what 0 means. With
  // only the producer under test, changing the guard here to arm a 0ms timer
  // would make a persistent notice vanish instantly and nothing would go red.
  it('treats duration 0 as persistent — never arms a zero-delay auto-dismiss', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    const longWait = new RateLimitError('Too Many Requests', 3_600_000);
    expect(longWait.getDisplayOptions().duration).toBe(0); // the producer half

    act(() => { result.current.showError(longWait); });
    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(1);

    // Well past any plausible auto-dismiss, including a 0ms one.
    act(() => { vi.advanceTimersByTime(60_000); });

    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(1);
  });

  // #306: a duplicate upload is reported to the user, but it is not a failure.
  it('shows a duplicate-upload notice as an info toast that dismisses itself, logged at info', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    act(() => { result.current.showError(new DuplicateUploadNotice([{ filename: 'app.log', origin: 'file_upload', turn: 2 }])); });

    const [shown] = result.current.errors;
    expect(shown.displayOptions).toMatchObject({ displayType: 'toast', icon: 'info', dismissible: true });
    expect(shown.displayOptions.duration).toBeGreaterThan(0);
    expect(log.info).toHaveBeenCalledWith('Notice shown', expect.objectContaining({ category: 'notice' }));
    expect(log.error).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(shown.displayOptions.duration ?? 0); });
    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(0);
  });

  // Three toasts at most. A notice gives way before a real error does.
  it('lets a notice give way before an error when the toasts are full', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    // The notice is NOT the oldest, so evicting the oldest would drop an error.
    act(() => { result.current.showError(statusError(500)); }); // ServerError
    act(() => { result.current.showError(statusError(408)); }); // TimeoutError
    act(() => { result.current.showError(new DuplicateUploadNotice([{ filename: 'app.log', origin: 'file_upload' }])); });
    act(() => { result.current.showError(statusError(403)); }); // PermissionError

    const visible = result.current.errors.filter(e => !e.dismissed);
    expect(visible.map(e => e.error.category)).toEqual(['server', 'timeout', 'authorization']);
  });

  it('still logs a real error at error level', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    act(() => { result.current.showError(statusError(500, 'server down')); });

    expect(log.error).toHaveBeenCalledWith('Error shown', expect.objectContaining({ category: 'server' }));
  });
});

describe('DuplicateUploadNotice', () => {
  // The server matches on content, so the message never claims the original had
  // the same name, and a paste or capture is named by what it is.
  it.each([
    [[{ filename: 'renamed.log', origin: 'file_upload' as const, turn: 2 }], 'renamed.log matches a file the case already has, from turn 2.'],
    [[{ filename: 'renamed.log', origin: 'file_upload' as const }], 'renamed.log matches a file the case already has.'],
    [[{ filename: 'pasted-content-20261007.txt', origin: 'text_paste' as const, turn: 2 }], 'This pasted text matches content the case already has, from turn 2.'],
    [[{ filename: 'page-capture-1.html', origin: 'page_capture' as const }], 'This page capture matches content the case already has.'],
    [
      [{ filename: 'a.log', origin: 'file_upload' as const, turn: 1 }, { filename: 'pasted-content-2.txt', origin: 'text_paste' as const }],
      '2 of these uploads match content the case already has: a.log, the pasted text.',
    ],
  ])('says what matched: %j', (duplicates, message) => {
    expect(new DuplicateUploadNotice(duplicates).userMessage).toBe(message);
  });

  // The same submission can carry new files, a paste or a question that WERE
  // stored, so "nothing new" is said only of what matched.
  it('says nothing new was stored only for the uploads it names', () => {
    expect(new DuplicateUploadNotice([{ filename: 'a.log', origin: 'file_upload' }]).userAction)
      .toBe('Nothing new was stored for it.');
    expect(new DuplicateUploadNotice([
      { filename: 'a.log', origin: 'file_upload' },
      { filename: 'b.log', origin: 'file_upload' },
    ]).userAction).toBe('Nothing new was stored for them.');
  });
});
