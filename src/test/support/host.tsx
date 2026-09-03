/**
 * Test host: a real in-memory `HostStore` behind the same context the
 * production hosts use.
 *
 * The point is not convenience. A converted hook can only be exercised through
 * a mounted host, so a test that renders one and asserts on THIS store is
 * evidence that the hook reaches storage through the adapter — if the call site
 * still went to `browser.storage.local`, the global mock in `setup.ts` would
 * answer it silently and the assertion here would find nothing.
 */
import React from 'react';
import { vi } from 'vitest';
import { HostAdapterProvider } from '../../shared/host';
import type { HostStore, StoredValue, WiredHost } from '../../shared/host';

type ChangeHandler = (changed: Record<string, StoredValue>) => void;

export interface StubHost {
  /** Pass to `renderHook(fn, { wrapper: hostWrapper(stub) })`. */
  host: WiredHost;
  store: HostStore;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  /** What the store currently holds. Mutate to stage a read. */
  data: Record<string, StoredValue>;
  /** Deliver a change to every subscriber that asked for one of these keys. */
  emit(changed: Record<string, StoredValue>): void;
}

export function createStubHost(seed: Record<string, StoredValue> = {}): StubHost {
  const data: Record<string, StoredValue> = { ...seed };
  const subscribers: Array<{ keys: string[]; onChange: ChangeHandler }> = [];
  const unsubscribe = vi.fn();

  const get = vi.fn(async (keys: string[]) => {
    const out: Record<string, StoredValue> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
    }
    return out;
  });

  const set = vi.fn(async (items: Record<string, StoredValue>) => {
    Object.assign(data, items);
  });

  const remove = vi.fn(async (keys: string[]) => {
    for (const key of keys) delete data[key];
  });

  const subscribe = vi.fn((keys: string[], onChange: ChangeHandler) => {
    const entry = { keys, onChange };
    subscribers.push(entry);
    return () => {
      const i = subscribers.indexOf(entry);
      if (i >= 0) subscribers.splice(i, 1);
      unsubscribe();
    };
  });

  const store = { get, set, remove, subscribe } as unknown as HostStore;

  return {
    host: { store },
    store,
    get,
    set,
    remove,
    subscribe,
    unsubscribe,
    data,
    emit(changed) {
      // Same membership rule the extension adapter applies: a key being present
      // is the signal, not its value.
      for (const { keys, onChange } of [...subscribers]) {
        const hit: Record<string, StoredValue> = {};
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(changed, key)) hit[key] = changed[key];
        }
        if (Object.keys(hit).length > 0) onChange(hit);
      }
    },
  };
}

/** A `renderHook` / `render` wrapper that mounts `host` above the tree. */
export function hostWrapper(host: WiredHost) {
  return function HostWrapper({ children }: { children: React.ReactNode }) {
    return <HostAdapterProvider value={host}>{children}</HostAdapterProvider>;
  };
}
