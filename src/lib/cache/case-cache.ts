
import { browser } from 'wxt/browser';
import { UserCase } from '../../types/case';
import { createLogger } from '../utils/logger';

const log = createLogger('CaseCacheManager');

interface CachedCaseList {
    cases: UserCase[];
    timestamp: number;
}

const CACHE_KEY = 'faultmaven_case_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class CaseCacheManager {
    /**
     * Get cached cases if valid
     */
    async getCachedCases(): Promise<UserCase[] | null> {
        try {
            const stored = await browser.storage.local.get([CACHE_KEY]);
            const cache = stored[CACHE_KEY] as CachedCaseList | undefined;

            if (!cache) {
                log.debug('Cache miss: No cache found');
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
                timestamp: Date.now()
            };
            await browser.storage.local.set({ [CACHE_KEY]: cache });
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
            await browser.storage.local.remove([CACHE_KEY]);
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
