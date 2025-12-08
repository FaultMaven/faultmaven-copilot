import { browser } from 'wxt/browser';
import { debounce } from './debounce';

/**
 * Batched Storage Manager
 * 
 * Consolidates multiple state updates into single storage writes to prevent
 * "write amplification" and improve performance.
 * 
 * Features:
 * - Debounces writes (500ms window)
 * - Batches multiple keys into a single set operation
 * - Handles browser.storage.local limitations
 */

type StorageValue = any;
type StorageBatch = Record<string, StorageValue>;

class BatchedStorageManager {
  private pendingWrites: StorageBatch = {};
  private isWriteScheduled = false;
  private readonly DEBOUNCE_MS = 500;

  /**
   * Queue a key-value pair for writing
   */
  public set(key: string, value: StorageValue): void {
    this.pendingWrites[key] = value;
    this.scheduleWrite();
  }

  /**
   * Queue multiple key-value pairs
   */
  public setMany(values: StorageBatch): void {
    Object.assign(this.pendingWrites, values);
    this.scheduleWrite();
  }

  /**
   * Schedule the actual write operation
   */
  private scheduleWrite = debounce(async () => {
    if (Object.keys(this.pendingWrites).length === 0) return;

    const writesToCommit = { ...this.pendingWrites };
    this.pendingWrites = {}; // Clear pending immediately to allow new writes during async op

    try {
      if (typeof browser !== 'undefined' && browser.storage) {
        console.log('[BatchedStorage] 💾 Committing batch write:', Object.keys(writesToCommit));
        await browser.storage.local.set(writesToCommit);
      } else {
        console.warn('[BatchedStorage] Browser storage not available, falling back to localStorage');
        Object.entries(writesToCommit).forEach(([key, value]) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch (e) {
            console.error(`[BatchedStorage] LocalStorage fallback failed for ${key}`, e);
          }
        });
      }
    } catch (error) {
      console.error('[BatchedStorage] ❌ Batch write failed:', error);
      // Re-queue failed writes? For now, we log.
      // A robust implementation might retry or keep them in pending.
    }
  }, { wait: this.DEBOUNCE_MS });

  /**
   * Force immediate write of pending changes
   */
  public async flush(): Promise<void> {
    if (Object.keys(this.pendingWrites).length === 0) return;
    
    // Cancel any scheduled debounce
    // (Note: our simple debounce implementation might not expose cancel, 
    // but calling the function directly works if we manage the queue correctly)
    
    const writesToCommit = { ...this.pendingWrites };
    this.pendingWrites = {};

    try {
      if (typeof browser !== 'undefined' && browser.storage) {
        await browser.storage.local.set(writesToCommit);
      }
    } catch (error) {
      console.error('[BatchedStorage] Flush failed:', error);
    }
  }
}

export const batchedStorage = new BatchedStorageManager();
