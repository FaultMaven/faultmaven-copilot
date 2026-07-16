import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ErrorHandlerProvider, useErrorHandler } from '../../../lib/errors/useErrorHandler';

vi.mock('~/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
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
});
