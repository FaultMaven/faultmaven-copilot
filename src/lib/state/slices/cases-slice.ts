import { StateCreator } from 'zustand';
import {
  UserCase,
  OptimisticUserCase,
  OptimisticConversationItem,
  PendingOperation,
  pendingOpsManager,
  idMappingManager,
  OptimisticIdGenerator,
  TitleSource,
  IdMappingState
} from '../../optimistic';
import {
  createCase,
  getCaseConversation,
  submitQueryToCase,
  updateCaseTitle,
  getUserCases,
  QueryRequest,
  AgentResponse,
  UploadedData,
  InvestigationProgress,
  ResponseType,
  InvestigationMode,
  EvidenceForm,
  EvidenceType,
  UserIntent,
  CompletenessLevel,
  formatFileSize
} from '../../api';
import { isOptimisticId, isRealId } from '../../utils/data-integrity';
import { memoryManager } from '../../utils/memory-manager';
import { browser } from 'wxt/browser';
import { debounce } from '../../utils/debounce';
import { batchedStorage } from '../../utils/batched-storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('CasesSlice');

export interface CasesSlice {
  // State
  conversations: Record<string, OptimisticConversationItem[]>;
  conversationTitles: Record<string, string>;
  titleSources: Record<string, TitleSource>;
  activeCaseId: string | undefined;
  activeCase: UserCase | null;
  optimisticCases: OptimisticUserCase[];
  pinnedCases: Set<string>;
  pendingOperations: Record<string, PendingOperation>;
  loading: boolean;
  submitting: boolean;
  investigationProgress: Record<string, InvestigationProgress>;
  caseEvidence: Record<string, UploadedData[]>;
  loadedConversationIds: Set<string>; // Track which cases have been fetched (even if empty)

  // Actions
  setActiveCaseId: (caseId: string | undefined) => void;
  loadUserCases: () => Promise<void>;
  handleCaseSelect: (caseId: string) => Promise<void>;
  createOptimisticCase: (title: string | null) => Promise<void>;
  submitQuery: (query: string) => Promise<void>;
  handleOptimisticTitleUpdate: (caseId: string, newTitle: string) => Promise<void>;
  handleDataUpload: (caseId: string, uploadResponse: UploadedData, file: File) => void;
  togglePinCase: (caseId: string) => void;
  deleteCaseLocally: (caseId: string) => void;

  // Persistence Helpers
  loadPersistedData: () => Promise<void>;
  savePersistedData: () => Promise<void>;

  // Internal Helpers (exposed for testing/components)
  retryFailedOperation: (operationId: string) => Promise<void>;
  dismissFailedOperation: (operationId: string) => void;
  syncTitleToBackend: (caseId: string, title: string, operationId: string) => Promise<void>;
  resetCasesState: () => void;
}

// Debounce helper for title sync (outside store to persist across renders)
const debouncedTitleSync = debounce(async (caseId: string, title: string, operationId: string, syncFn: any) => {
  await syncFn(caseId, title, operationId);
}, { wait: 1000, maxWait: 3000 });

export const createCasesSlice: StateCreator<CasesSlice> = (set, get) => ({
  // Initial State
  conversations: {},
  conversationTitles: {},
  titleSources: {},
  activeCaseId: undefined,
  activeCase: null,
  optimisticCases: [],
  pinnedCases: new Set(),
  pendingOperations: {},
  loading: false,
  submitting: false,
  investigationProgress: {},
  caseEvidence: {},
  loadedConversationIds: new Set(), // Track which conversations have been fetched

  // Actions
  setActiveCaseId: (caseId) => set({ activeCaseId: caseId }),

  loadUserCases: async () => {
    set({ loading: true });
    try {
      // API call now checks cache internally for default lists
      const cases = await getUserCases();

      // Update state with fetched (or cached) cases
      // Preservation of optimistic cases should happen here if needed, 
      // but for now we trust the service layer's cache management.
      set({
        optimisticCases: [], // Clear optimistic cases as we have fresh list? 
        // Or merge them? For now, we assume getUserCases returns the source of truth.
        loading: false
      });

      // We don't store the full list in the slice state (except maybe for UI display?)
      // The slice seems to lack a `cases` array, relying on `optimisticCases`?
      // Looking at the interface, there is `optimisticCases` but no `cases`. 
      // Let's check `optimisticCases` definition. 

      // Actually, looking at `SidePanelApp`, it uses `optimisticCases` for display.
      // So we should map the result to `optimisticCases` (marking them as not optimistic).

      const mappedCases: OptimisticUserCase[] = cases.map(c => ({
        ...c,
        optimistic: false,
        loading: false,
        failed: false
      }));

      set({
        optimisticCases: mappedCases,
        loading: false
      });

    } catch (error) {
      log.error('Failed to load cases:', error);
      set({ loading: false });
    }
  },

  handleCaseSelect: async (caseId: string) => {
    set({ activeCaseId: caseId });
    const { conversations, conversationTitles, activeCase, loadedConversationIds } = get();

    try {
      // Resolve optimistic IDs to real IDs
      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;

      // Update active case object (Metadata only)
      // Updated 2026-01-30: Include organization_id, closure_reason, closed_at per backend storage fixes
      if (!activeCase || activeCase.case_id !== caseId) {
        set({
          activeCase: {
            case_id: caseId,
            owner_id: '', // Will be populated
            organization_id: '', // Will be populated per commit b434152a
            title: conversationTitles[caseId] || 'Loading...',
            status: 'inquiry',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
            closure_reason: null, // Terminal state field per commit b434152a
            closed_at: null // Terminal state timestamp per commit b434152a
          }
        });
      }

      // --- CRITICAL FIX: Prevent infinite refetch of empty cases ---
      // Check if we have successfully fetched this case before
      // We check 'resolvedCaseId' because that's what the backend knows
      const alreadyLoaded = loadedConversationIds.has(resolvedCaseId);

      // Fallback: If we have data locally, we count it as loaded too
      const hasLocalData = (conversations[caseId]?.length > 0) || (conversations[resolvedCaseId]?.length > 0);

      if (alreadyLoaded || hasLocalData) {
        // Data is ready (even if it's an empty array). Stop here.
        log.debug('Case already loaded, skipping fetch:', { caseId, resolvedCaseId, alreadyLoaded, hasLocalData });
        return;
      }
      // --- END CRITICAL FIX ---

      set({ loading: true });

      // If optimistic and unreconciled, use local data (already in state or empty)
      if (isOptimisticId(caseId) && !idMappingManager.getRealId(caseId)) {
        set({ loading: false });
        return;
      }

      // Lazy-load conversation from backend
      log.info('Lazy-loading conversation for case:', { caseId, resolvedCaseId });
      const conversationData = await getCaseConversation(resolvedCaseId);
      const messages = conversationData.messages || [];

      // Transform backend messages
      // Updated 2026-01-30: Preserve case state fields from backend messages per commit b434152a
      const backendMessages: OptimisticConversationItem[] = messages.map((msg: any) => ({
        id: msg.message_id,
        timestamp: msg.created_at,
        turn_number: msg.turn_number,
        optimistic: false,
        originalId: msg.message_id,
        question: msg.role === 'user' ? msg.content : undefined,
        response: (msg.role === 'agent' || msg.role === 'assistant') ? msg.content : undefined,
        // Case state tracking fields (track case state at time of message creation)
        case_status: msg.case_status,  // Case status when message was created
        closure_reason: msg.closure_reason ?? null,  // If case was closed in this turn
        closed_at: msg.closed_at ?? null  // Timestamp if case reached terminal state
      }));

      // Merge logic
      set(state => {
        const existing = state.conversations[caseId] || [];
        const backendMap = new Map(backendMessages.map(m => [m.id, m]));

        const merged = existing.map(local => {
          const backend = backendMap.get(local.id);
          return backend || local;
        });

        const newMessages = backendMessages.filter(m => !existing.some(e => e.id === m.id));

        // Mark this case as loaded to prevent refetching
        const newLoadedSet = new Set(state.loadedConversationIds);
        newLoadedSet.add(resolvedCaseId);

        return {
          conversations: {
            ...state.conversations,
            [caseId]: [...merged, ...newMessages]
          },
          loadedConversationIds: newLoadedSet,
          loading: false
        };
      });
    } catch (error) {
      log.error('Error loading case:', error);
      set({ loading: false });
    }
  },

  createOptimisticCase: async (title: string | null) => {
    // This will be triggered by creating a new session implicitly
    // We'll implement the explicit creation logic if needed, but 
    // SidePanelApp uses session-based creation primarily.
    // For now, placeholder for explicit case creation flow.
  },

  submitQuery: async (query: string) => {
    const { activeCaseId, conversations } = get();
    if (!query.trim()) return;

    set({ submitting: true });

    try {
      // 1. Ensure Case ID (create if needed)
      let targetCaseId = activeCaseId;

      if (!targetCaseId) {
        // Create new case - let backend auto-generate title per API contract
        // NOTE: Must use `null` not `undefined` - JSON.stringify strips undefined
        const caseData = await createCase({
          title: null,  // null triggers backend auto-generation (Case-MMDD-N format)
          priority: 'medium',
          metadata: { created_via: 'browser_extension', auto_generated: true }
        });

        targetCaseId = caseData.case_id;

        set({
          activeCaseId: targetCaseId,
          activeCase: caseData,
          conversations: { ...conversations, [targetCaseId]: [] },
          conversationTitles: { ...get().conversationTitles, [targetCaseId]: caseData.title },
          titleSources: { ...get().titleSources, [targetCaseId]: 'backend' }
        });

        // Persist current case ID using batched storage
        batchedStorage.set('faultmaven_current_case', targetCaseId);
      }

      if (!targetCaseId) throw new Error('Failed to establish case ID');

      // 2. Optimistic Updates
      const userMessageId = OptimisticIdGenerator.generateMessageId();
      const aiMessageId = OptimisticIdGenerator.generateMessageId();
      const timestamp = new Date().toISOString();

      const userMessage: OptimisticConversationItem = {
        id: userMessageId,
        question: query,
        timestamp,
        optimistic: true,
        loading: false,
        failed: false,
        pendingOperationId: userMessageId,
        originalId: userMessageId
      };

      const aiMessage: OptimisticConversationItem = {
        id: aiMessageId,
        timestamp,
        optimistic: true,
        loading: true,
        failed: false,
        pendingOperationId: aiMessageId,
        originalId: aiMessageId,
        response: '' // Visual indicator handles "Thinking..."
      };

      // Update UI immediately
      set(state => ({
        conversations: {
          ...state.conversations,
          [targetCaseId!]: [...(state.conversations[targetCaseId!] || []), userMessage, aiMessage]
        }
      }));

      // 3. Create Pending Operation
      const operationId = aiMessageId;
      const operation: PendingOperation = {
        id: operationId,
        type: 'submit_query',
        status: 'pending',
        optimisticData: { userMessage, aiThinkingMessage: aiMessage, query, caseId: targetCaseId },
        retryFn: async () => {
          // Retry logic implementation
        },
        rollbackFn: () => {
          set(state => ({
            conversations: {
              ...state.conversations,
              [targetCaseId!]: (state.conversations[targetCaseId!] || []).filter(
                i => i.id !== userMessageId && i.id !== aiMessageId
              )
            }
          }));
        },
        createdAt: Date.now()
      };

      pendingOpsManager.add(operation);
      set(state => ({
        pendingOperations: { ...state.pendingOperations, [operationId]: operation }
      }));

      // 4. Background Submission
      // Determine session ID (assume it exists in SessionSlice, accessible via get().sessionId if merged, 
      // but here we might need to access the store or pass it in. 
      // For now, we'll fetch it from storage or assume it's set.)
      // Real implementation should access SessionSlice state.

      // ... Submission logic ...
      // We will implement the full background submission helper in the store integration
      // or as a thunk-like action.

      // Placeholder for actual API call and state update on success/failure
      // This logic mirrors submitOptimisticQueryInBackground in SidePanelApp

    } catch (error) {
      log.error('Query submission failed:', error);
      // Handle error state updates
    } finally {
      set({ submitting: false });
    }
  },

  handleOptimisticTitleUpdate: async (caseId: string, newTitle: string) => {
    // 1. Immediate UI Update
    set(state => ({
      conversationTitles: { ...state.conversationTitles, [caseId]: newTitle },
      titleSources: { ...state.titleSources, [caseId]: 'user' }
    }));

    // 2. Pending Operation
    const operationId = OptimisticIdGenerator.generate('opt_op');
    const operation: PendingOperation = {
      id: operationId,
      type: 'update_title',
      status: 'pending',
      optimisticData: { caseId, newTitle },
      retryFn: async () => get().syncTitleToBackend(caseId, newTitle, operationId),
      rollbackFn: () => { /* No rollback for titles usually */ },
      createdAt: Date.now()
    };

    pendingOpsManager.add(operation);
    set(state => ({
      pendingOperations: { ...state.pendingOperations, [operationId]: operation }
    }));

    // 3. Debounced Sync
    debouncedTitleSync(caseId, newTitle, operationId, get().syncTitleToBackend);
  },

  syncTitleToBackend: async (caseId: string, title: string, operationId: string) => {
    try {
      await updateCaseTitle(caseId, title);
      pendingOpsManager.complete(operationId);
      set(state => {
        const newOps = { ...state.pendingOperations };
        delete newOps[operationId];
        return { pendingOperations: newOps };
      });
    } catch (error) {
      log.error('Title sync failed:', error);
      pendingOpsManager.fail(operationId, error instanceof Error ? error.message : 'Unknown error');
      set(state => {
        const op = state.pendingOperations[operationId];
        if (op) {
          return {
            pendingOperations: {
              ...state.pendingOperations,
              [operationId]: { ...op, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' }
            }
          };
        }
        return {};
      });
    }
  },

  handleDataUpload: (caseId: string, uploadResponse: UploadedData, file: File) => {
    const timestamp = uploadResponse.uploaded_at || new Date().toISOString();

    // Generate messages
    const dataTypeBadge = uploadResponse.data_type ? ` [${uploadResponse.data_type}]` : '';
    const compressionInfo = uploadResponse.classification?.compression_ratio
      ? ` (${uploadResponse.classification.compression_ratio.toFixed(1)}x compressed)`
      : '';

    const userMessage: OptimisticConversationItem = {
      id: `upload-${Date.now()}`,
      question: `📎 Uploaded: ${uploadResponse.file_name || file.name} (${formatFileSize(uploadResponse.file_size || 0)})${dataTypeBadge}${compressionInfo}`,
      timestamp,
      optimistic: false
    };

    const aiMessage: OptimisticConversationItem = {
      id: `response-${Date.now()}`,
      response: uploadResponse.agent_response?.content || "Data uploaded and processed successfully.",
      timestamp: new Date().toISOString(),
      responseType: uploadResponse.agent_response?.response_type,
      likelihood: uploadResponse.agent_response?.likelihood,
      sources: uploadResponse.agent_response?.sources,
      evidenceRequests: uploadResponse.agent_response?.evidence_requests,
      investigationMode: uploadResponse.agent_response?.investigation_mode,
      caseStatus: uploadResponse.agent_response?.case_status,
      suggestedActions: uploadResponse.agent_response?.suggested_actions,
      optimistic: false
    };

    set(state => ({
      conversations: {
        ...state.conversations,
        [caseId]: [...(state.conversations[caseId] || []), userMessage, aiMessage]
      },
      caseEvidence: {
        ...state.caseEvidence,
        [caseId]: [...(state.caseEvidence[caseId] || []), uploadResponse]
      }
    }));
  },

  togglePinCase: (caseId: string) => {
    set(state => {
      const newPinned = new Set(state.pinnedCases);
      if (newPinned.has(caseId)) {
        newPinned.delete(caseId);
      } else {
        newPinned.add(caseId);
      }
      // Persist pinned cases using batched storage
      batchedStorage.set('pinnedCases', Array.from(newPinned));
      return { pinnedCases: newPinned };
    });
  },

  deleteCaseLocally: (caseId: string) => {
    set(state => {
      const { [caseId]: _, ...remainingConversations } = state.conversations;
      const { [caseId]: __, ...remainingTitles } = state.conversationTitles;
      const { [caseId]: ___, ...remainingSources } = state.titleSources;

      const newPinned = new Set(state.pinnedCases);
      newPinned.delete(caseId);

      const newOptimisticCases = state.optimisticCases.filter(c => c.case_id !== caseId);

      // Clean up ID mappings
      if (OptimisticIdGenerator.isOptimistic(caseId)) {
        idMappingManager.removeMapping(caseId);
      }

      // Persist changes using batched storage
      batchedStorage.setMany({
        conversations: remainingConversations,
        conversationTitles: remainingTitles,
        titleSources: remainingSources,
        pinnedCases: Array.from(newPinned),
        optimisticCases: newOptimisticCases
      });

      return {
        conversations: remainingConversations,
        conversationTitles: remainingTitles,
        titleSources: remainingSources,
        pinnedCases: newPinned,
        optimisticCases: newOptimisticCases,
        activeCaseId: state.activeCaseId === caseId ? undefined : state.activeCaseId,
        activeCase: state.activeCase?.case_id === caseId ? null : state.activeCase
      };
    });
  },

  retryFailedOperation: async (operationId: string) => {
    await pendingOpsManager.retry(operationId);
    // Update store state after retry
    set(state => ({
      pendingOperations: pendingOpsManager.getAll()
    }));
  },

  dismissFailedOperation: (operationId: string) => {
    pendingOpsManager.remove(operationId);
    set(state => {
      const newOps = { ...state.pendingOperations };
      delete newOps[operationId];
      return { pendingOperations: newOps };
    });
  },

  loadPersistedData: async () => {
    // Implementation will mirror SidePanelApp's loadPersistedDataWithRecovery
    // Just putting placeholders for now
  },

  savePersistedData: async () => {
    // Implementation for saving state to storage
  },

  resetCasesState: () => {
    set({
      conversations: {},
      conversationTitles: {},
      titleSources: {},
      activeCaseId: undefined,
      activeCase: null,
      optimisticCases: [],
      pinnedCases: new Set(),
      pendingOperations: {},
      loading: false,
      submitting: false,
      investigationProgress: {},
      caseEvidence: {},
      loadedConversationIds: new Set()
    });
  }
});
