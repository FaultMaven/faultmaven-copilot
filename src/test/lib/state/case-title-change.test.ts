import { describe, it, expect, vi } from 'vitest';
import { applyCaseTitleChange, type CaseTitleChangeDeps } from '@faultmaven/copilot-ui/lib/state/case-title-change';

/**
 * fm#1069, second failure: clicking "Generate title" showed a 409 and reverted.
 *
 * `POST /cases/{id}/title` persists the row itself, so the client also PUTting the
 * returned value was a redundant second write — and on a terminal case the backend
 * refuses writes with 409 (`require_case_not_terminal`). The failure path then
 * rolled the generated title back out of the UI and raised an error toast for a
 * change that had already succeeded.
 */

function makeDeps(overrides: Partial<CaseTitleChangeDeps> = {}) {
  const store = {
    conversationTitles: {} as Record<string, string>,
    titleSources: {} as Record<string, 'user' | 'backend' | 'system'>
  };

  const deps: CaseTitleChangeDeps = {
    readStore: () => store,
    setConversationTitles: (updater) => {
      store.conversationTitles = updater(store.conversationTitles);
    },
    setTitleSources: (updater) => {
      store.titleSources = updater(store.titleSources);
    },
    persistTitle: vi.fn().mockResolvedValue(undefined),
    onPersistError: vi.fn(),
    ...overrides
  };

  return { deps, store };
}

describe('applyCaseTitleChange', () => {
  describe("source 'backend' — already persisted by POST /title", () => {
    it('updates the store WITHOUT a second write to the backend', async () => {
      const { deps, store } = makeDeps();

      await applyCaseTitleChange('case-1', 'Postgres pool exhaustion', 'backend', deps);

      expect(store.conversationTitles['case-1']).toBe('Postgres pool exhaustion');
      expect(store.titleSources['case-1']).toBe('backend');
      expect(deps.persistTitle).not.toHaveBeenCalled();
    });

    it('keeps the generated title even when a PUT would have 409ed', async () => {
      // The exact terminal-case shape: any PUT here comes back 409. Since none is
      // sent, the title stands and no error reaches the user.
      const persistTitle = vi.fn().mockRejectedValue(new Error('409 Conflict'));
      const { deps, store } = makeDeps({ persistTitle });

      await applyCaseTitleChange('case-1', 'Checkout 502s after v2.1.3', 'backend', deps);

      expect(store.conversationTitles['case-1']).toBe('Checkout 502s after v2.1.3');
      expect(deps.onPersistError).not.toHaveBeenCalled();
    });
  });

  describe("source 'user' — the client is the origin", () => {
    it('persists the title the user typed', async () => {
      const { deps, store } = makeDeps();

      await applyCaseTitleChange('case-1', 'My own name for this', 'user', deps);

      expect(deps.persistTitle).toHaveBeenCalledWith('case-1', 'My own name for this');
      expect(store.conversationTitles['case-1']).toBe('My own name for this');
      expect(store.titleSources['case-1']).toBe('user');
    });

    it('rolls both maps back to their exact prior values when the write fails', async () => {
      const persistTitle = vi.fn().mockRejectedValue(new Error('boom'));
      const { deps, store } = makeDeps({ persistTitle });
      store.conversationTitles['case-1'] = 'Prior title';
      store.titleSources['case-1'] = 'backend';

      await applyCaseTitleChange('case-1', 'Attempted rename', 'user', deps);

      expect(store.conversationTitles['case-1']).toBe('Prior title');
      expect(store.titleSources['case-1']).toBe('backend');
      expect(deps.onPersistError).toHaveBeenCalled();
    });

    it('removes the keys entirely when there was nothing there before', async () => {
      // Restoring `undefined` as a value rather than deleting the key would leave
      // `conversationTitles[caseId]` present-but-undefined, which reads as "the
      // store has an entry" to anything checking membership.
      const persistTitle = vi.fn().mockRejectedValue(new Error('boom'));
      const { deps, store } = makeDeps({ persistTitle });

      await applyCaseTitleChange('case-1', 'Attempted rename', 'user', deps);

      expect('case-1' in store.conversationTitles).toBe(false);
      expect('case-1' in store.titleSources).toBe(false);
    });
  });
});
