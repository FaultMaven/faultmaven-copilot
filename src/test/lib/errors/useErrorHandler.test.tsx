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

    act(() => { result.current.showError(new DuplicateUploadNotice([{ filename: 'app.log', turn: 2 }])); });

    const [shown] = result.current.errors;
    expect(shown.displayOptions).toMatchObject({ displayType: 'toast', icon: 'info', dismissible: true });
    expect(shown.displayOptions.duration).toBeGreaterThan(0);
    expect(log.info).toHaveBeenCalledWith('Notice shown', expect.objectContaining({ category: 'notice' }));
    expect(log.error).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(shown.displayOptions.duration ?? 0); });
    expect(result.current.errors.filter(e => !e.dismissed)).toHaveLength(0);
  });

  it('still logs a real error at error level', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper });

    act(() => { result.current.showError(statusError(500, 'server down')); });

    expect(log.error).toHaveBeenCalledWith('Error shown', expect.objectContaining({ category: 'server' }));
  });
});

describe('DuplicateUploadNotice', () => {
  it.each([
    [[{ filename: 'app.log', turn: 2 }], 'app.log was already uploaded on turn 2.'],
    [[{ filename: 'app.log' }], 'app.log was already uploaded.'],
    [[{ filename: 'a.log', turn: 1 }, { filename: 'b.log' }], '2 files were already uploaded: a.log, b.log.'],
  ])('says which uploads added nothing: %j', (duplicates, message) => {
    const notice = new DuplicateUploadNotice(duplicates);
    expect(notice.userMessage).toBe(message);
    expect(notice.userAction).toBe('Nothing new was added to the case.');
  });
});
