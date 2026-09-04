/**
 * Recover conversations after an extension reload, before the panel mounts.
 *
 * This ran inside the shared `useDataRecovery`, which did two jobs in one
 * effect: decide whether the local cache was lost and refill it from the
 * backend, then hydrate the store from storage. Only the second is shared — a
 * web page cannot reload an extension and has no `runtime.id` to notice it
 * with — so the first is here.
 *
 * ORDER IS THE REASON IT IS A GATE rather than a parallel effect. Recovery
 * WRITES storage and hydration READS it; running them side by side would hydrate
 * the pre-recovery state and leave the user looking at an empty panel with their
 * cases sitting in storage. Mounting the panel only after this settles keeps the
 * sequence the single effect had, and shows the same "Recovering session…"
 * screen while it runs.
 */
import { useEffect, useState } from 'react';
import { PersistenceManager } from '@faultmaven/copilot-ui/lib/utils/persistence-manager';
import { detectExtensionReload, clearReloadFlag, stampRuntimeIdentity } from './extension-reload';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('ExtensionReloadRecovery');

/**
 * @param enabled whether a session exists yet. Recovery talks to the backend,
 *   so it cannot run before there is a credential to talk with.
 * @returns whether recovery is in flight.
 */
export function useExtensionReloadRecovery(enabled: boolean): boolean {
  const [isRecovering, setIsRecovering] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!enabled || settled) return;
    let cancelled = false;

    (async () => {
      try {
        if (await PersistenceManager.isRecoveryInProgress()) {
          log.info('Recovery already in progress in another context; not starting a second');
          return;
        }

        if (!(await detectExtensionReload())) return;

        log.info('Extension reload detected - starting conversation recovery');
        if (!cancelled) setIsRecovering(true);

        const result = await PersistenceManager.recoverConversationsFromBackend();
        if (result.success) {
          log.info('Conversation recovery successful', {
            cases: result.recoveredCases,
            conversations: result.recoveredConversations,
          });
          await clearReloadFlag();
        } else {
          log.warn('Conversation recovery failed', { errors: result.errors });
        }
      } catch (error) {
        log.error('Reload recovery failed', error);
      } finally {
        // Whatever happened, THIS runtime is now the one the stored data belongs
        // to. Stamped even when nothing was recovered, so a detection that fired
        // on a version bump does not fire again on every launch.
        await stampRuntimeIdentity();
        if (!cancelled) {
          setIsRecovering(false);
          setSettled(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, settled]);

  return isRecovering;
}
