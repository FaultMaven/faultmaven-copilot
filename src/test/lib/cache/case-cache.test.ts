
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaseCacheManager } from '../../../lib/cache/case-cache';
import { UserCase } from '../../../types/case';

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

vi.mock('wxt/browser', () => ({
    browser: {
        storage: {
            local: mockStorage,
        },
    },
}));

describe('CaseCacheManager', () => {
    let manager: CaseCacheManager;
    const mockCases: UserCase[] = [
        {
            case_id: '123',
            title: 'Test Case',
            status: 'inquiry',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 5,
            owner_id: 'user1',
            organization_id: 'org1',
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
                    timestamp: Date.now()
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toEqual(mockCases);
        });

        it('returns null and invalidates when cache is expired', async () => {
            const past = Date.now() - (6 * 60 * 1000); // 6 minutes ago
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: past
                }
            });

            const result = await manager.getCachedCases();
            expect(result).toBeNull();
            expect(mockStorage.remove).toHaveBeenCalledWith(['faultmaven_case_cache']);
        });
    });

    describe('setCachedCases', () => {
        it('stores cases with timestamp', async () => {
            await manager.setCachedCases(mockCases);

            expect(mockStorage.set).toHaveBeenCalledWith(expect.objectContaining({
                faultmaven_case_cache: expect.objectContaining({
                    cases: mockCases,
                    timestamp: expect.any(Number)
                })
            }));
        });
    });

    describe('updateOptimisticCase', () => {
        it('updates specific case in cache', async () => {
            // Setup existing cache
            mockStorage.get.mockResolvedValue({
                faultmaven_case_cache: {
                    cases: mockCases,
                    timestamp: Date.now()
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
                    timestamp: Date.now()
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
