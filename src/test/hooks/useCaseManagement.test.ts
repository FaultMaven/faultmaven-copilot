import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaseManagement } from '../../shared/ui/hooks/useCaseManagement';
import { useAppStore } from '../../lib/state/store';
import { browser } from 'wxt/browser';

// Mock dependencies
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
vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

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
