import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaseManagement } from '../../shared/ui/hooks/useCaseManagement';
import { browser } from 'wxt/browser';
import * as api from '../../lib/api';

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

vi.mock('../../lib/api', () => ({
  createCase: vi.fn()
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
  const mockSessionId = 'session-123';
  const mockCaseId = 'case-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useCaseManagement(mockSessionId));
      expect(result.current.currentCaseId).toBeNull();
      expect(result.current.isCreatingCase).toBe(false);
    });
  });

  describe('ensureCaseExists', () => {
    it('should throw error if no session provided', async () => {
      const { result } = renderHook(() => useCaseManagement(null));
      await expect(result.current.ensureCaseExists()).rejects.toThrow('Cannot create case without session');
    });

    it('should return existing case from state if available', async () => {
      const { result } = renderHook(() => useCaseManagement(mockSessionId));
      
      // Manually set state via setActiveCase first
      await act(async () => {
        await result.current.setActiveCase(mockCaseId);
      });

      const caseId = await result.current.ensureCaseExists();
      expect(caseId).toBe(mockCaseId);
      expect(api.createCase).not.toHaveBeenCalled();
    });

    it('should return case from storage if available', async () => {
      // Mock storage to return a case
      (browser.storage.local.get as any).mockResolvedValue({ faultmaven_current_case: mockCaseId });

      const { result } = renderHook(() => useCaseManagement(mockSessionId));
      
      let caseId;
      await act(async () => {
        caseId = await result.current.ensureCaseExists();
      });
      
      expect(caseId).toBe(mockCaseId);
      expect(result.current.currentCaseId).toBe(mockCaseId);
      expect(api.createCase).not.toHaveBeenCalled();
    });

    it('should create new case via API if not in state or storage', async () => {
      // Mock storage empty
      (browser.storage.local.get as any).mockResolvedValue({});
      // Mock API response
      (api.createCase as any).mockResolvedValue({ case_id: mockCaseId });

      const { result } = renderHook(() => useCaseManagement(mockSessionId));
      
      let caseId;
      await act(async () => {
        caseId = await result.current.ensureCaseExists();
      });

      expect(caseId).toBe(mockCaseId);
      expect(result.current.currentCaseId).toBe(mockCaseId);
      expect(api.createCase).toHaveBeenCalled();
      expect(browser.storage.local.set).toHaveBeenCalledWith({ faultmaven_current_case: mockCaseId });
    });

    it('should handle API failure correctly', async () => {
      (browser.storage.local.get as any).mockResolvedValue({});
      (api.createCase as any).mockRejectedValue(new Error('API Error'));

      const { result } = renderHook(() => useCaseManagement(mockSessionId));

      await expect(async () => {
        await act(async () => {
          await result.current.ensureCaseExists();
        });
      }).rejects.toThrow('API Error');
      
      expect(result.current.isCreatingCase).toBe(false);
    });
  });

  describe('createNewCase', () => {
    it('should force create new case even if one exists', async () => {
      (api.createCase as any).mockResolvedValue({ case_id: 'new-case-456' });

      const { result } = renderHook(() => useCaseManagement(mockSessionId));

      let newCaseId;
      await act(async () => {
        newCaseId = await result.current.createNewCase();
      });

      expect(newCaseId).toBe('new-case-456');
      expect(result.current.currentCaseId).toBe('new-case-456');
      expect(api.createCase).toHaveBeenCalled();
      expect(browser.storage.local.set).toHaveBeenCalledWith({ faultmaven_current_case: 'new-case-456' });
    });
  });

  describe('setActiveCase', () => {
    it('should update state and storage', async () => {
      const { result } = renderHook(() => useCaseManagement(mockSessionId));

      await act(async () => {
        await result.current.setActiveCase(mockCaseId);
      });

      expect(result.current.currentCaseId).toBe(mockCaseId);
      expect(browser.storage.local.set).toHaveBeenCalledWith({ faultmaven_current_case: mockCaseId });
    });

    it('should remove from storage if caseId is null', async () => {
      const { result } = renderHook(() => useCaseManagement(mockSessionId));

      await act(async () => {
        await result.current.setActiveCase(null);
      });

      expect(result.current.currentCaseId).toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(['faultmaven_current_case']);
    });
  });

  describe('clearCurrentCase', () => {
    it('should clear state and storage without API call', async () => {
      const { result } = renderHook(() => useCaseManagement(mockSessionId));

      await act(async () => {
        await result.current.clearCurrentCase();
      });

      expect(result.current.currentCaseId).toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(['faultmaven_current_case']);
      expect(api.createCase).not.toHaveBeenCalled();
    });
  });
});
