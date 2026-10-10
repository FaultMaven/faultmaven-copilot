/**
 * `reloadDrivenCaseList`: the one invalidate-then-reload sequence that takes a
 * case the user no longer drives out of the sidebar (fm#1898). Ordered, and
 * fenced on the session it was learned in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { reloadDrivenCaseList } from '@faultmaven/copilot-ui/lib/state/case-list-reload';
import { bumpEpoch, getEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';

const order: string[] = [];
let unsubscribe: () => void;

beforeEach(() => {
  order.length = 0;
  unsubscribe = useAppStore.subscribe((s, prev) => {
    if (s.refreshSessions !== prev.refreshSessions) order.push('reload');
  });
});
afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
});

describe('reloadDrivenCaseList', () => {
  it('drops the slot, then reloads the list', async () => {
    vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      order.push('invalidate');
    });
    await reloadDrivenCaseList(getEpoch());
    expect(order).toEqual(['invalidate', 'reload']);
  });

  it('does nothing for a session that has already ended', async () => {
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockResolvedValue();
    const epoch = getEpoch();
    bumpEpoch();
    await reloadDrivenCaseList(epoch);
    expect(invalidate).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('a sign-out while the slot is dropped leaves the new session’s list alone', async () => {
    vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      order.push('invalidate');
      bumpEpoch();
    });
    await reloadDrivenCaseList(getEpoch());
    expect(order).toEqual(['invalidate']);
  });
});
