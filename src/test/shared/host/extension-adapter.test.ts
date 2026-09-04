import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extensionHost } from '../../../shared/host';

/**
 * The extension adapter is a wrapper, so most of it is only worth asserting is
 * a pass-through. `subscribe` is not a pass-through: it adds the area filter
 * and the key filter that every call site used to re-derive for itself, and
 * those two rules are where a wrong answer would be silent.
 */
const b = (global as any).browser;
const origOnChanged = b.storage.onChanged;

type Listener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string,
) => void;

describe('extensionHost.store', () => {
  let listeners: Listener[];

  beforeEach(() => {
    vi.clearAllMocks();
    listeners = [];
    b.storage.onChanged = {
      addListener: vi.fn((l: Listener) => listeners.push(l)),
      removeListener: vi.fn((l: Listener) => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      }),
    };
  });

  afterEach(() => {
    b.storage.onChanged = origOnChanged;
  });

  const fire = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area = 'local',
  ) => {
    for (const l of [...listeners]) l(changes, area);
  };

  it('passes get / set / remove straight through to storage.local', async () => {
    b.storage.local.get.mockResolvedValue({ a: 1 });

    await expect(extensionHost.store.get(['a'])).resolves.toEqual({ a: 1 });
    expect(b.storage.local.get).toHaveBeenCalledWith(['a']);

    await extensionHost.store.set({ a: 2 });
    expect(b.storage.local.set).toHaveBeenCalledWith({ a: 2 });

    await extensionHost.store.remove(['a']);
    expect(b.storage.local.remove).toHaveBeenCalledWith(['a']);
  });

  it('delivers only the subscribed keys, and only their new values', () => {
    const onChange = vi.fn();
    extensionHost.store.subscribe(['wanted'], onChange);

    fire({ wanted: { newValue: 'yes' }, ignored: { newValue: 'no' } });

    expect(onChange).toHaveBeenCalledWith({ wanted: 'yes' });
  });

  it('does not fire when no subscribed key changed', () => {
    const onChange = vi.fn();
    extensionHost.store.subscribe(['wanted'], onChange);

    fire({ somethingElse: { newValue: 'x' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  // Membership, not truthiness. A cleared key arrives with `newValue`
  // undefined; filtering on the value would make a removal invisible to the
  // subscriber that cares about it most.
  it('fires on a REMOVAL of a subscribed key', () => {
    const onChange = vi.fn();
    extensionHost.store.subscribe(['wanted'], onChange);

    fire({ wanted: { oldValue: 'gone' } });

    expect(onChange).toHaveBeenCalledWith({ wanted: undefined });
  });

  // `sync`, `session` and `managed` share this event. A caller asking about a
  // local key must not be woken by a same-named key in another area.
  it('ignores changes in any area other than local', () => {
    const onChange = vi.fn();
    extensionHost.store.subscribe(['wanted'], onChange);

    fire({ wanted: { newValue: 'from sync' } }, 'sync');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops delivering after the returned unsubscribe is called', () => {
    const onChange = vi.fn();
    const unsubscribe = extensionHost.store.subscribe(['wanted'], onChange);

    unsubscribe();
    expect(b.storage.onChanged.removeListener).toHaveBeenCalled();

    fire({ wanted: { newValue: 'after' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('extensionHost.navigation', () => {
  const origTabs = b.tabs;
  const origRuntime = b.runtime;

  beforeEach(() => {
    vi.clearAllMocks();
    // Where the Dashboard lives is read from the configured endpoint.
    b.storage.local.get.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    b.tabs = { query: vi.fn().mockResolvedValue([]), update: vi.fn(), create: vi.fn() };
    b.runtime = { ...(origRuntime ?? {}), openOptionsPage: vi.fn() };
  });

  afterEach(() => {
    b.tabs = origTabs;
    b.runtime = origRuntime;
  });

  it('opens a new tab at base + path when no Dashboard tab exists', async () => {
    await extensionHost.navigation.dashboard('/cases/case-1');

    expect(b.tabs.query).toHaveBeenCalledWith({ url: 'https://app.faultmaven.ai/*' });
    expect(b.tabs.create).toHaveBeenCalledWith({ url: 'https://app.faultmaven.ai/cases/case-1' });
    expect(b.tabs.update).not.toHaveBeenCalled();
  });

  // Focus-or-create. Navigating a tab that is already on the target throws away
  // its scroll position and any form state, so an already-correct tab is only
  // focused.
  it('focuses an existing Dashboard tab without navigating it when it is already on the target', async () => {
    b.tabs.query.mockResolvedValue([{ id: 7, url: 'https://app.faultmaven.ai/cases/case-1?x=1' }]);

    await extensionHost.navigation.dashboard('/cases/case-1');

    expect(b.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(b.tabs.create).not.toHaveBeenCalled();
  });

  it('navigates an existing Dashboard tab that is somewhere else', async () => {
    b.tabs.query.mockResolvedValue([{ id: 7, url: 'https://app.faultmaven.ai/kb' }]);

    await extensionHost.navigation.dashboard('/cases');

    expect(b.tabs.update).toHaveBeenCalledWith(7, {
      active: true,
      url: 'https://app.faultmaven.ai/cases',
    });
  });

  it('falls back to a plain window when the tabs API refuses', async () => {
    b.tabs.query.mockRejectedValue(new Error('permission revoked'));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    await extensionHost.navigation.dashboard('/cases');

    expect(open).toHaveBeenCalledWith('https://app.faultmaven.ai/cases', '_blank');
    open.mockRestore();
  });

  // The extension HAS a settings surface, so this member is a function. A host
  // without one supplies null and the UI draws nothing.
  it('settings opens the extension options page', async () => {
    expect(extensionHost.navigation.settings).not.toBeNull();
    await extensionHost.navigation.settings!();
    expect(b.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
