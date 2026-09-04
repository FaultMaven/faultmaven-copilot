import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaseManagement } from '@faultmaven/copilot-ui/shared/ui/hooks/useCaseManagement';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { browser } from 'wxt/browser';

// Mock dependencies
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
      }
    }
  }
}));

// Mock logger
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
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

describe('useCaseManagement', () => {
  const mockCaseId = 'case-123';

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeCaseId: null,
      activeCase: null,
      conversations: {},
      conversationTitles: {},
      titleSources: {},
      pinnedCases: new Set(),
      caseEvidence: {},
      sessionId: null
    });
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useCaseManagement());
      expect(result.current.currentCaseId).toBeNull();
    });
  });

  describe('setActiveCase', () => {
    it('should update state and storage', async () => {
      const { result } = renderHook(() => useCaseManagement());

      await act(async () => {
        await result.current.setActiveCase(mockCaseId);
      });

      expect(result.current.currentCaseId).toBe(mockCaseId);
      expect(browser.storage.local.set).toHaveBeenCalledWith({ faultmaven_current_case: mockCaseId });
    });

    it('should remove from storage if caseId is null', async () => {
      const { result } = renderHook(() => useCaseManagement());

      await act(async () => {
        await result.current.setActiveCase(null);
      });

      expect(result.current.currentCaseId).toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(['faultmaven_current_case']);
    });
  });
});
