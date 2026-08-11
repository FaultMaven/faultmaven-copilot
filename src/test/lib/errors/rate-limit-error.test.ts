import { describe, it, expect } from 'vitest';
import { MAX_AUTO_RETRY_WAIT_MS, RateLimitError } from '~lib/errors/types';

/**
 * A 429's `Retry-After` is measured, honest and uncapped — the backend reports
 * the instant the oldest entry ages out of the window that refused, so a
 * per-minute bucket asks for seconds and an hourly bucket asks for up to an
 * hour. `RateLimitError` is where that number is turned into a policy: short
 * enough to wait out, or long enough that the user has to be told.
 */
describe('RateLimitError: recovery derives from the server\'s window', () => {
  it('auto-retries a wait inside the bound and promises the retry it will make', () => {
    const error = new RateLimitError('Too Many Requests', 5_000);

    expect(error.recovery).toBe('auto_retry_with_delay');
    expect(error.userAction).toBe("We'll try again in 5 seconds...");
  });

  it('treats the bound itself as waitable (boundary is inclusive)', () => {
    const error = new RateLimitError('Too Many Requests', MAX_AUTO_RETRY_WAIT_MS);

    expect(error.recovery).toBe('auto_retry_with_delay');
    expect(error.userAction).toBe("We'll try again in a minute...");
  });

  it('hands the retry to the user one millisecond past the bound', () => {
    // The near-miss, so the comparison cannot silently widen to `<`.
    const error = new RateLimitError('Too Many Requests', MAX_AUTO_RETRY_WAIT_MS + 1);

    expect(error.recovery).toBe('manual_retry');
  });

  it('states the real wait for an hourly window instead of promising a retry', () => {
    // The copy is the defect the auto-retry path hid: it said "we'll try again
    // in 3600 seconds" while retrying after 60 and then giving up entirely, so
    // every part of that sentence was false.
    const error = new RateLimitError('Too Many Requests', 3_600_000);

    expect(error.recovery).toBe('manual_retry');
    expect(error.userAction).toBe('You can try again in about 60 minutes.');
    expect(error.retryAfterMs).toBe(3_600_000);
  });

  it('rounds a partial minute up, never down', () => {
    // Understating sends the user back before their quota exists and earns a
    // second refusal; overstating costs idle seconds.
    expect(new RateLimitError('x', 61_000).userAction).toBe('You can try again in about 2 minutes.');
    expect(new RateLimitError('x', 119_000).userAction).toBe('You can try again in about 2 minutes.');
  });

  it('defaults to a waitable 5s when the server sent no Retry-After', () => {
    const error = new RateLimitError('Too Many Requests');

    expect(error.retryAfterMs).toBe(5_000);
    expect(error.recovery).toBe('auto_retry_with_delay');
  });
});

describe('RateLimitError: the toast cannot outlive the user\'s patience', () => {
  it('pins an auto-retry toast for exactly the wait it is covering', () => {
    const error = new RateLimitError('Too Many Requests', 5_000);
    const options = error.getDisplayOptions();

    // Undismissible for 5s is deliberate: it clears itself the moment the
    // retry fires, so the toast and the wait end together.
    expect(options.duration).toBe(5_000);
    expect(options.dismissible).toBe(false);
  });

  it('makes a long-wait toast dismissible and stops auto-dismissing it', () => {
    // useErrorHandler auto-dismisses on `duration`, so the raw hourly value
    // scheduled an undismissible banner to sit on the panel for an hour.
    const error = new RateLimitError('Too Many Requests', 3_600_000);
    const options = error.getDisplayOptions();

    expect(options.duration).toBe(0); // 0 = persistent, no hour-long timer
    expect(options.dismissible).toBe(true);
  });
});
