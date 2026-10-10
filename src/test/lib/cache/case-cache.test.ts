
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

        it('an optimistic edit whose read straddles an invalidation writes nothing', async () => {
            mockStorage.get.mockImplementation(async () => {
                await manager.invalidateCache();
                return {
                    faultmaven_case_cache: { cases: mockCases, timestamp: Date.now(), version: CASE_CACHE_VERSION }
                };
            });
            await manager.updateOptimisticCase('123', { title: 'Updated Title' });
            await manager.addOptimisticCase({ ...mockCases[0], case_id: '456' });
            expect(mockStorage.set).not.toHaveBeenCalled();
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

    describe('addOptimisticCase', () => {
        it('adds new case to beginning of cache', async () => {
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: Date.now(),
                    version: CASE_CACHE_VERSION
                }
            });

            const newCase: UserCase = {
                ...mockCases[0],
                case_id: '456',
                title: 'New Case'
            };

            await manager.addOptimisticCase(newCase);

            expect(mockStorage.set).toHaveBeenCalled();
            const setCall = mockStorage.set.mock.calls[0][0];
            const storedCases = setCall.faultmaven_case_cache.cases;
            expect(storedCases.length).toBe(2);
            expect(storedCases[0].case_id).toBe('456');
        });
    });
});
