
import { UserCase } from '../../types/case';
import { createLogger } from '../utils/logger';
import { ownedStorage } from '../owned-storage';

const log = createLogger('CaseCacheManager');

interface CachedCaseList {
    cases: UserCase[];
    timestamp: number;
    version: number;
}

const CACHE_KEY = 'faultmaven_case_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Schema version of the persisted case rows.
 *
 * This cache is the only place a `UserCase` outlives the session, so it is the
 * only place a row written by an OLDER build can be read back by a newer one.
 * The TTL bounds staleness, not shape: a row five seconds old is served
 * whatever build wrote it.
 *
 * v1 (ADR-017 Phase 7a) is the first stamped version. Rows written before it
 * carry `organization_id` as the tenant and no `enterprise_id` at all, and are
 * DISCARDED rather than tolerated — a row whose tenant field has moved is not
 * a row this build can read, and reading it would put a case with no
 * enterprise into the sidebar with nothing to say so.
 *
 * Bump this whenever the persisted `UserCase` shape changes.
 */
export const CASE_CACHE_VERSION = 1;

export class CaseCacheManager {
    /**
     * Get cached cases if valid
     */
    async getCachedCases(): Promise<UserCase[] | null> {
        try {
            const stored = await ownedStorage.get([CACHE_KEY]);
            const cache = stored[CACHE_KEY] as CachedCaseList | undefined;

            if (!cache) {
                log.debug('Cache miss: No cache found');
                return null;
            }

            // Shape before staleness: a row from an older build is unreadable
            // whatever its age. An unstamped cache is pre-v1 by definition.
            if (cache.version !== CASE_CACHE_VERSION) {
                log.info('Cache miss: written by an older schema, discarding', {
                    cachedVersion: cache.version,
                    currentVersion: CASE_CACHE_VERSION
                });
                await this.invalidateCache();
                return null;
            }

            const now = Date.now();
            if (now - cache.timestamp > CACHE_TTL_MS) {
                log.debug('Cache miss: Expired', { age: now - cache.timestamp });
                // Clean up expired cache
                await this.invalidateCache();
                return null;
            }

            log.debug('Cache hit', { count: cache.cases.length });
            return cache.cases;
        } catch (error) {
            log.warn('Failed to read cache:', error);
            return null;
        }
    }

    /**
     * Set cached cases
     */
    async setCachedCases(cases: UserCase[]): Promise<void> {
        try {
            const cache: CachedCaseList = {
                cases,
                timestamp: Date.now(),
                version: CASE_CACHE_VERSION
            };
            await ownedStorage.set({ [CACHE_KEY]: cache });
            log.debug('Cache updated', { count: cases.length });
        } catch (error) {
            log.error('Failed to write cache:', error);
        }
    }

    /**
     * Invalidate/Clear cache
     */
    async invalidateCache(): Promise<void> {
        try {
            await ownedStorage.remove([CACHE_KEY]);
            log.debug('Cache invalidated');
        } catch (error) {
            log.error('Failed to invalidate cache:', error);
        }
    }

    /**
     * Optimistically update a specific case in the cache
     */
    async updateOptimisticCase(caseId: string, changes: Partial<UserCase>): Promise<void> {
        try {
            const currentCases = await this.getCachedCases();
            if (!currentCases) return; // Nothing to update

            const index = currentCases.findIndex(c => c.case_id === caseId);
            if (index !== -1) {
                currentCases[index] = { ...currentCases[index], ...changes };
                await this.setCachedCases(currentCases);
                log.debug('Optimistic cache update', { caseId, changes });
            }
        } catch (error) {
            log.warn('Failed to optimistically update cache:', error);
        }
    }

    /**
     * Add a new case to the cache optimistically
     */
    async addOptimisticCase(newCase: UserCase): Promise<void> {
        try {
            const currentCases = await this.getCachedCases();
            if (!currentCases) return; // If no cache, no need to add (next fetch will get it)

            // Add to beginning of list
            const updatedCases = [newCase, ...currentCases];
            await this.setCachedCases(updatedCases);
            log.debug('Optimistic cache add', { caseId: newCase.case_id });
        } catch (error) {
            log.warn('Failed to optimistically add to cache:', error);
        }
    }
}

export const caseCacheManager = new CaseCacheManager();
