
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CASE_CACHE_VERSION, CaseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { UserCase } from '@faultmaven/copilot-ui/types/case';

// Mock wxt/browser
const { mockStorage } = vi.hoisted(() => {
    return {
        mockStorage: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn(),
        }
    };
});

import { browser } from 'wxt/browser';

import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';

vi.mock('wxt/browser', () => ({
    browser: {
        storage: {
            local: mockStorage,
        },
    },
}));

// The store, slices and persistence reach storage through the HOST now. This
// file mocks `wxt/browser` for itself, so the bridge is bound to THAT mock —
// otherwise the shared default in setup.ts would answer from the global mock and
// every assertion here would watch a store nothing wrote to.
beforeEach(() => {
  setHostStore({
    get: (keys) => browser.storage.local.get(keys),
    set: (items) => browser.storage.local.set(items),
    remove: (keys) => browser.storage.local.remove(keys),
    subscribe: () => () => {},
  });
});

describe('CaseCacheManager', () => {
    let manager: CaseCacheManager;
    const mockCases: UserCase[] = [
        {
            case_id: '123',
            title: 'Test Case',
            state: 'inquiry',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 5,
            owner_id: 'user1',
            enterprise_id: 'ent1',
            closure_reason: null,
            closed_at: null
        }
    ];

    beforeEach(() => {
        manager = new CaseCacheManager();
        vi.clearAllMocks();
    });

    describe('getCachedCases', () => {
        it('returns null when cache is empty', async () => {
            mockStorage.get.mockResolvedValue({});
            const result = await manager.getCachedCases();
            expect(result).toBeNull();
        });

        it('returns cases when cache is valid', async () => {
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: Date.now(),
                    version: CASE_CACHE_VERSION
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toEqual(mockCases);
        });

        // ADR-017 Phase 7a. A row written before the tenant field moved names its
        // case's organization and no enterprise at all. It is DISCARDED, not
        // read: a UserCase whose `enterprise_id` is absent is a case with no
        // tenant, and the sidebar has no way to say so.
        it('drops a case row persisted under an older schema version', async () => {
            const preEnterpriseRow = {
                case_id: '123',
                title: 'Test Case',
                state: 'inquiry',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                message_count: 5,
                owner_id: 'user1',
                organization_id: 'org1',
                closure_reason: null,
                closed_at: null
            };
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: [preEnterpriseRow],
                    timestamp: Date.now(),
                    version: CASE_CACHE_VERSION - 1
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toBeNull();
            expect(mockStorage.remove).toHaveBeenCalledWith(['faultmaven_case_cache']);
        });

        // ADR-020 (fm#1898): a v1 slot holds every case the user could READ,
        // naming no driver. The sidebar now lists only the cases its user
        // drives, so serving that page would put cases they cannot write back
        // in the list until the TTL ran out.
        it('drops a v1 slot: every readable case, no driver', async () => {
            expect(CASE_CACHE_VERSION).toBe(2);
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: Date.now(),
                    version: 1
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toBeNull();
            expect(mockStorage.remove).toHaveBeenCalledWith(['faultmaven_case_cache']);
        });

        // The shape written before this version was STAMPED at all: no `version`
        // key. Same verdict, and the check must not read `undefined` as current.
        it('drops a case row persisted with no schema stamp', async () => {
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: Date.now()
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toBeNull();
            expect(mockStorage.remove).toHaveBeenCalledWith(['faultmaven_case_cache']);
        });

        it('returns null and invalidates when cache is expired', async () => {
            const past = Date.now() - (6 * 60 * 1000); // 6 minutes ago
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: past,
                    version: CASE_CACHE_VERSION
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toBeNull();
            expect(mockStorage.remove).toHaveBeenCalledWith(['faultmaven_case_cache']);
        });
    });

    describe('setCachedCases', () => {
        it('stores cases with timestamp', async () => {
            await manager.setCachedCases(mockCases, manager.currentGeneration());

            expect(mockStorage.set).toHaveBeenCalledWith(expect.objectContaining({
                faultmaven_case_cache: expect.objectContaining({
                    cases: mockCases,
                    timestamp: expect.any(Number),
                    version: CASE_CACHE_VERSION
                })
            }));
        });
    });

    // A writer captures the generation when it starts; an invalidation since
    // then means its page predates the invalidation, and the write is refused.
    describe('generation (fm#1898)', () => {
        it('an invalidation moves the generation', async () => {
            const before = manager.currentGeneration();
            await manager.invalidateCache();
            expect(manager.currentGeneration()).toBe(before + 1);
        });

        it('the generation moves before the removal is awaited', () => {
            const before = manager.currentGeneration();
            void manager.invalidateCache();
            expect(manager.currentGeneration()).toBe(before + 1);
        });

        it('refuses a write captured before an invalidation', async () => {
            const captured = manager.currentGeneration();
            await manager.invalidateCache();
            await manager.setCachedCases(mockCases, captured);
            expect(mockStorage.set).not.toHaveBeenCalled();
        });

        // Not awaited: the invalidation comes from another caller while the
        // edit's read is out. Its removal queues behind the edit (#330), but
        // the generation moves at once, so the edit's write is refused.
        it('an optimistic edit whose read straddles an invalidation writes nothing', async () => {
            mockStorage.get.mockImplementation(async () => {
                void manager.invalidateCache();
                return {
                    faultmaven_case_cache: { cases: mockCases, timestamp: Date.now(), version: CASE_CACHE_VERSION }
                };
            });
            await manager.updateOptimisticCase('123', { title: 'Updated Title' });
            expect(mockStorage.set).not.toHaveBeenCalled();
        });
    });

    // #325. The slot's timestamp is when its page was FETCHED from the server,
    // and the TTL bounds how long a list the user did not change can be served.
    // A local edit (a rename, a generated title) changes a row
    // the user already knows about; re-stamping it restarted the TTL for the
    // whole page, so a case reassigned to or away from the user (fm#1898) stayed
    // hidden for as long as they kept renaming.
    describe('local edits keep the fetch time (#325)', () => {
        const MINUTE = 60 * 1000;
        let stored: Record<string, unknown>;
        const fetchedAtInStorage = () => (stored.faultmaven_case_cache as { timestamp: number }).timestamp;

        beforeEach(() => {
            vi.useFakeTimers();
            stored = {};
            mockStorage.get.mockImplementation(async (keys: string[]) =>
                Object.fromEntries(keys.filter(k => k in stored).map(k => [k, structuredClone(stored[k])])));
            mockStorage.set.mockImplementation(async (items: Record<string, unknown>) => {
                Object.assign(stored, structuredClone(items));
            });
            mockStorage.remove.mockImplementation(async (keys: string[]) => {
                for (const k of keys) delete stored[k];
            });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('an optimistic title edit does not extend the TTL', async () => {
            await manager.setCachedCases(mockCases, manager.currentGeneration());
            vi.advanceTimersByTime(4 * MINUTE);

            await manager.updateOptimisticCase('123', { title: 'Renamed' });
            expect((await manager.getCachedCases())?.[0].title).toBe('Renamed');

            vi.advanceTimersByTime(2 * MINUTE);
            expect(await manager.getCachedCases()).toBeNull();
        });

        it('an edit keeps the stored fetch time exactly', async () => {
            await manager.setCachedCases(mockCases, manager.currentGeneration());
            const fetchedAt = fetchedAtInStorage();
            vi.advanceTimersByTime(3 * MINUTE);

            await manager.updateOptimisticCase('123', { title: 'Renamed' });
            expect(fetchedAtInStorage()).toBe(fetchedAt);
        });

        it('a fresh page from the server does restart the TTL', async () => {
            await manager.setCachedCases(mockCases, manager.currentGeneration());
            vi.advanceTimersByTime(4 * MINUTE);

            await manager.setCachedCases(mockCases, manager.currentGeneration());
            vi.advanceTimersByTime(2 * MINUTE);
            expect(await manager.getCachedCases()).toEqual(mockCases);
        });
    });

    describe('updateOptimisticCase', () => {
        it('updates specific case in cache', async () => {
            // Setup existing cache
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: Date.now(),
                    version: CASE_CACHE_VERSION
                }
            });

            await manager.updateOptimisticCase('123', { title: 'Updated Title' });

            // Verify set was called with updated data
            expect(mockStorage.set).toHaveBeenCalled();
            const setCall = mockStorage.set.mock.calls[0][0];
            const storedCases = setCall.faultmaven_case_cache.cases;
            expect(storedCases[0].title).toBe('Updated Title');
        });

        it('does nothing if cache is empty', async () => {
            mockStorage.get.mockResolvedValue({});
            await manager.updateOptimisticCase('123', { title: 'Updated Title' });
            expect(mockStorage.set).not.toHaveBeenCalled();
        });
    });
});
