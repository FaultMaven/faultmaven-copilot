import { StateCreator } from 'zustand';
import { ConflictDetectionResult, ConflictResolution, MergeResult } from '../../optimistic';

export interface UISlice {
  // State
  activeTab: 'copilot';
  sidebarCollapsed: boolean;
  hasUnsavedNewChat: boolean;
  
  // Modal State
  isDocumentModalOpen: boolean;
  viewingDocument: any | null;
  
  // Report Dialog State
  showReportDialog: boolean;
  
  // Conflict Resolution State
  conflictResolution: {
    isOpen: boolean;
    conflict: ConflictDetectionResult | null;
    localData: any;
    remoteData: any;
    mergeResult?: MergeResult<any>;
    resolveCallback?: (resolution: ConflictResolution) => void;
  };

  // Actions
  setActiveTab: (tab: 'copilot') => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setHasUnsavedNewChat: (hasUnsaved: boolean) => void;
  
  // Modal Actions
  openDocumentModal: (document: any) => void;
  closeDocumentModal: () => void;
  
  openReportDialog: () => void;
  closeReportDialog: () => void;
  
  // Conflict Resolution Actions
  openConflictResolution: (data: Omit<UISlice['conflictResolution'], 'isOpen'>) => void;
  closeConflictResolution: () => void;
  resolveConflict: (resolution: ConflictResolution) => void;
}

export const createUISlice: StateCreator<UISlice> = (set, get) => ({
  // Initial State
  activeTab: 'copilot',
  sidebarCollapsed: false,
  hasUnsavedNewChat: false,
  
  isDocumentModalOpen: false,
  viewingDocument: null,
  
  showReportDialog: false,
  
  conflictResolution: {
    isOpen: false,
    conflict: null,
    localData: null,
    remoteData: null
  },

  // Actions
  setActiveTab: (tab) => set({ activeTab: tab }),
  
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  
  setHasUnsavedNewChat: (hasUnsaved) => set({ hasUnsavedNewChat: hasUnsaved }),
  
  openDocumentModal: (document) => set({ 
    isDocumentModalOpen: true, 
    viewingDocument: document 
  }),
  
  closeDocumentModal: () => set({ 
    isDocumentModalOpen: false, 
    viewingDocument: null 
  }),
  
  openReportDialog: () => set({ showReportDialog: true }),
  
  closeReportDialog: () => set({ showReportDialog: false }),
  
  openConflictResolution: (data) => set({
    conflictResolution: {
      ...data,
      isOpen: true
    }
  }),
  
  closeConflictResolution: () => {
    const { resolveCallback } = get().conflictResolution;
    // Default to keeping local if closed without resolution
    if (resolveCallback) {
      resolveCallback({ choice: 'keep_local' });
    }
    set({
      conflictResolution: {
        isOpen: false,
        conflict: null,
        localData: null,
        remoteData: null,
        resolveCallback: undefined
      }
    });
  },
  
  resolveConflict: (resolution) => {
    const { resolveCallback } = get().conflictResolution;
    if (resolveCallback) {
      resolveCallback(resolution);
    }
    set({
      conflictResolution: {
        isOpen: false,
        conflict: null,
        localData: null,
        remoteData: null,
        resolveCallback: undefined
      }
    });
  }
});
