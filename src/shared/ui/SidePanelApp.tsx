// src/shared/ui/SidePanelApp.tsx
import React, { useState, useEffect, useRef } from "react";
import { browser } from "wxt/browser";
import { debounce } from "../../lib/utils/debounce";
import {
  getKnowledgeDocument,
  devLogin,
  logoutAuth,
  UserCase,
  UploadedData,
  createCase,
  createSession,
  submitQueryToCase,
  uploadDataToCase,
  getUserCases,
  getCaseConversation,
  updateCaseTitle,
  QueryRequest,
  authManager,
  AuthenticationError,
  SourceMetadata
} from "../../lib/api";
import { ErrorHandlerProvider, useErrorHandler, useError } from "../../lib/errors";
import { retryWithBackoff } from "../../lib/utils/retry";
import { NetworkStatusMonitor } from "../../lib/utils/network-status";
import { ToastContainer } from "./components/Toast";
import { ErrorModal } from "./components/ErrorModal";
import {
  OptimisticIdGenerator,
  IdUtils,
  pendingOpsManager,
  idMappingManager,
  conflictResolver,
  MergeStrategies,
  OptimisticUserCase,
  OptimisticConversationItem,
  PendingOperation,
  IdMappingState,
  ConflictDetectionResult,
  MergeResult,
  MergeContext
} from "../../lib/optimistic";
import {
  validateStateIntegrity,
  isOptimisticId,
  isRealId,
  debugDataSeparation
} from "../../lib/utils/data-integrity";
import KnowledgeBaseView from "./KnowledgeBaseView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorState } from "./components/ErrorState";
import ConversationsList from "./components/ConversationsList";
import { ChatWindow } from "./components/ChatWindow";
import DocumentDetailsModal from "./components/DocumentDetailsModal";
import { ConflictResolutionModal, ConflictResolution } from "./components/ConflictResolutionModal";
import { PersistenceManager } from "../../lib/utils/persistence-manager";
import { memoryManager } from "../../lib/utils/memory-manager";

// Make PersistenceManager available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).PersistenceManager = PersistenceManager;
}

// TypeScript interfaces for better type safety
interface StorageResult {
  sessionId?: string;
  sessionCreatedAt?: number;
  sessionResumed?: boolean;
  clientId?: string;
}

// ===== OPTIMISTIC UPDATES SYSTEM =====
// All optimistic update types, utilities, and managers are now imported from ~lib/optimistic

// Wrapper component that provides error handling context
export default function SidePanelApp() {
  return (
    <ErrorHandlerProvider>
      <SidePanelAppContent />
    </ErrorHandlerProvider>
  );
}

// Main app content with error handler integration
function SidePanelAppContent() {
  const { getErrorsByType, dismissError } = useErrorHandler();
  const { showError, showErrorWithRetry } = useError();

  const [activeTab, setActiveTab] = useState<'copilot' | 'kb'>('copilot');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({});
  const [titleSources, setTitleSources] = useState<Record<string, 'user' | 'backend' | 'system'>>({});
  const [activeCaseId, setActiveCaseId] = useState<string | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hasUnsavedNewChat, setHasUnsavedNewChat] = useState(false);
  const [refreshSessions, setRefreshSessions] = useState(0);
  const [pinnedCases, setPinnedCases] = useState<Set<string>>(new Set());
  // Removed pendingCases - no longer using pending mechanism

  // SINGLE SOURCE OF TRUTH: Conversation and case state (with optimistic updates)
  const [conversations, setConversations] = useState<Record<string, OptimisticConversationItem[]>>({});
  const [pendingOperations, setPendingOperations] = useState<Record<string, PendingOperation>>({});
  const [activeCase, setActiveCase] = useState<UserCase | null>(null);
  const [optimisticCases, setOptimisticCases] = useState<OptimisticUserCase[]>([]); // Track optimistic cases for ConversationsList
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false); // For input locking during message submission

  // OODA Framework v3.2.0: Investigation progress tracking
  const [investigationProgress, setInvestigationProgress] = useState<Record<string, any>>({});
  
  // Document viewing state
  const [viewingDocument, setViewingDocument] = useState<any | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);

  // Conflict resolution state
  const [conflictResolutionData, setConflictResolutionData] = useState<{
    isOpen: boolean;
    conflict: ConflictDetectionResult | null;
    localData: any;
    remoteData: any;
    mergeResult?: MergeResult<any>;
    resolveCallback?: (resolution: ConflictResolution) => void;
  }>({
    isOpen: false,
    conflict: null,
    localData: null,
    remoteData: null
  });

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Track whether we need to load conversations from backend (after rebuild/login)

  // Use singleton Pending Operations Manager from optimistic module
  // Note: pendingOpsManager is imported as singleton from the optimistic module

  // Helper function to get failed operations that need user attention
  const getFailedOperationsForUser = (): PendingOperation[] => {
    return pendingOpsManager.getByStatus('failed').filter(op =>
      // Only show operations that affect current context
      op.type === 'create_case' && op.optimisticData?.case_id === activeCaseId ||
      op.type === 'submit_query' && op.optimisticData?.caseId === activeCaseId ||
      op.type === 'update_title' && op.optimisticData?.caseId === activeCaseId
    );
  };

  // Retry handler for user-triggered retries
  const handleUserRetry = async (operationId: string) => {
    try {
      console.log('[SidePanelApp] 🔄 User triggered retry for operation:', operationId);
      await pendingOpsManager.retry(operationId);
      console.log('[SidePanelApp] ✅ User retry successful');
      // Operation will be automatically marked as completed or failed by the retry logic
    } catch (error) {
      console.error('[SidePanelApp] ❌ User retry failed:', error);
      showError(error, { operation: 'retry_operation', metadata: { operationId } });
    }
  };

  // Dismiss handler for failed operations
  const handleDismissFailedOperation = (operationId: string) => {
    console.log('[SidePanelApp] 🗑️ User dismissed failed operation:', operationId);
    pendingOpsManager.remove(operationId);
  };

  // Show conflict resolution modal
  const showConflictResolution = (
    conflict: ConflictDetectionResult,
    localData: any,
    remoteData: any,
    mergeResult?: MergeResult<any>
  ): Promise<ConflictResolution> => {
    return new Promise((resolve) => {
      setConflictResolutionData({
        isOpen: true,
        conflict,
        localData,
        remoteData,
        mergeResult,
        resolveCallback: resolve
      });
    });
  };

  // Handle conflict resolution choice
  const handleConflictResolution = (resolution: ConflictResolution) => {
    if (conflictResolutionData.resolveCallback) {
      conflictResolutionData.resolveCallback(resolution);
    }
    setConflictResolutionData(prev => ({ ...prev, isOpen: false, resolveCallback: undefined }));
  };

  // Cancel conflict resolution
  const cancelConflictResolution = () => {
    if (conflictResolutionData.resolveCallback) {
      conflictResolutionData.resolveCallback({ choice: 'keep_local' }); // Default to keeping local
    }
    setConflictResolutionData(prev => ({ ...prev, isOpen: false, resolveCallback: undefined }));
  };


  // Enhanced error messaging for different operation types
  const getErrorMessageForOperation = (operation: PendingOperation): { title: string; message: string; recoveryHint: string } => {
    const baseError = operation.error || 'An unknown error occurred';

    switch (operation.type) {
      case 'create_case':
        return {
          title: 'Failed to Create Chat',
          message: baseError,
          recoveryHint: 'Check your internet connection and try again. If the problem persists, refresh the page.'
        };
      case 'submit_query':
        return {
          title: 'Failed to Send Message',
          message: baseError,
          recoveryHint: 'Your message was not sent. Try sending it again or check your connection.'
        };
      case 'update_title':
        return {
          title: 'Failed to Update Title',
          message: baseError,
          recoveryHint: 'The title change was not saved. You can try again or continue without changing it.'
        };
      default:
        return {
          title: 'Operation Failed',
          message: baseError,
          recoveryHint: 'Please try again or contact support if the issue persists.'
        };
    }
  };

  // INTELLIGENT PERSISTENCE STRATEGY: Handle extension reload vs normal session
  // - Login/Logout: browser.storage.local persists across browser sessions
  // - Extension Reload: Chrome clears browser.storage.local completely
  // - Solution: Detect reload and automatically recover from backend APIs
  useEffect(() => {
    const loadPersistedDataWithRecovery = async () => {
      try {
        console.log('[SidePanelApp] 🔄 Starting intelligent persistence loading...');

        // Step 1: Check if recovery is already in progress
        const recoveryInProgress = await PersistenceManager.isRecoveryInProgress();
        if (recoveryInProgress) {
          console.log('[SidePanelApp] ⏳ Recovery already in progress, waiting...');
          return;
        }

        // Step 2: Detect if extension was reloaded
        const reloadDetected = await PersistenceManager.detectExtensionReload();
        console.log('[SidePanelApp] 🔍 Extension reload detected:', reloadDetected);

        if (reloadDetected) {
          // Extension was reloaded - attempt recovery from backend
          console.log('[SidePanelApp] 🚨 Extension reload detected - starting conversation recovery...');
          setLoading(true);

          const recoveryResult = await PersistenceManager.recoverConversationsFromBackend();

          if (recoveryResult.success) {
            console.log('[SidePanelApp] ✅ Conversation recovery successful:', recoveryResult);
            // Error cleared

            // Show user feedback about recovery
            if (recoveryResult.recoveredCases > 0) {
              console.log(`[SidePanelApp] 🎉 Recovered ${recoveryResult.recoveredCases} chats with ${recoveryResult.recoveredConversations} messages`);
              // Could add a toast notification here in the future
            }
          } else {
            console.warn('[SidePanelApp] ⚠️ Conversation recovery failed:', recoveryResult);
            if (recoveryResult.errors.length > 0) {
              showError(`Failed to recover conversations: ${recoveryResult.errors[0]}`);
            }
          }

          setLoading(false);
        }

        // Step 3: Load data from storage (either original or recovered)
        console.log('[SidePanelApp] 📂 Loading data from browser storage...');
        const stored = await browser.storage.local.get([
          'conversationTitles',
          'titleSources',
          'conversations',
          'pendingOperations',
          'optimisticCases',
          'idMappings',
          'pinnedCases'
        ]);
        console.log('[SidePanelApp] 📄 Retrieved from storage:', {
          titleCount: stored.conversationTitles ? Object.keys(stored.conversationTitles).length : 0,
          conversationCount: stored.conversations ? Object.keys(stored.conversations).length : 0,
          hasPendingOps: !!stored.pendingOperations,
          hasIdMappings: !!stored.idMappings
        });

        // Load conversation titles
        if (stored.conversationTitles) {
          console.log('[SidePanelApp] 📝 Loading conversation titles:', Object.keys(stored.conversationTitles).length);
          setConversationTitles(stored.conversationTitles);
        }

        // Load title sources
        if (stored.titleSources) {
          console.log('[SidePanelApp] 🏷️ Loading title sources:', Object.keys(stored.titleSources).length);
          setTitleSources(stored.titleSources);
        }

        // Load conversations
        if (stored.conversations && Object.keys(stored.conversations).length > 0) {
          console.log('[SidePanelApp] 💬 Loading conversations:', Object.keys(stored.conversations).length);
          setConversations(stored.conversations);
        } else {
          console.log('[SidePanelApp] 📭 No conversations in storage');
        }

        // Load optimistic state (pending operations)
        if (stored.pendingOperations) {
          console.log('[SidePanelApp] ⏳ Loading pending operations:', Object.keys(stored.pendingOperations).length);
          setPendingOperations(stored.pendingOperations);
          pendingOpsManager.updateOperations(stored.pendingOperations);
        }

        // Load optimistic cases
        if (stored.optimisticCases) {
          console.log('[SidePanelApp] 🔧 Loading optimistic cases:', stored.optimisticCases.length);
          setOptimisticCases(stored.optimisticCases);
        }

        // Load pinned cases
        if (stored.pinnedCases && Array.isArray(stored.pinnedCases)) {
          console.log('[SidePanelApp] 📌 Loading pinned cases:', stored.pinnedCases.length);
          setPinnedCases(new Set(stored.pinnedCases));
        }

        // Load ID mappings
        if (stored.idMappings) {
          console.log('[SidePanelApp] 🔗 Loading ID mappings:', stored.idMappings);
          const mappings = stored.idMappings;
          if (mappings.optimisticToReal && mappings.realToOptimistic) {
            const idMappingState: IdMappingState = {
              optimisticToReal: new Map(Object.entries(mappings.optimisticToReal)),
              realToOptimistic: new Map(Object.entries(mappings.realToOptimistic))
            };
            idMappingManager.setState(idMappingState);
          }
        }

        // Mark persistence loading complete
        await PersistenceManager.markSyncComplete();
        console.log('[SidePanelApp] ✅ Persistence loading completed successfully');

      } catch (error) {
        console.error('[SidePanelApp] ❌ Persistence loading failed:', error);
        showError(`Failed to load conversations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setLoading(false);
      }
    };

    loadPersistedDataWithRecovery();
  }, []);

  // Persistence: Save conversation titles when they change
  useEffect(() => {
    if (Object.keys(conversationTitles).length > 0) {
      console.log('[SidePanelApp] Saving conversation titles to storage:', Object.keys(conversationTitles));
      browser.storage.local.set({ conversationTitles }).then(() => {
        console.log('[SidePanelApp] ✅ Conversation titles saved successfully');
      }).catch((error) => {
        console.error('[SidePanelApp] ❌ Failed to save conversation titles:', error);
      });
    }
  }, [conversationTitles]);

  // Persistence: Save title sources when they change
  useEffect(() => {
    if (Object.keys(titleSources).length > 0) {
      console.log('[SidePanelApp] Saving title sources to storage:', Object.keys(titleSources));
      browser.storage.local.set({ titleSources }).then(() => {
        console.log('[SidePanelApp] ✅ Title sources saved successfully');
      }).catch((error) => {
        console.error('[SidePanelApp] ❌ Failed to save title sources:', error);
      });
    }
  }, [titleSources]);

  // Persistence: Save conversations when they change
  useEffect(() => {
    if (Object.keys(conversations).length > 0) {
      console.log('[SidePanelApp] Saving conversations to storage:', Object.keys(conversations));
      console.log('[SidePanelApp] Conversation data being saved:', conversations);
      browser.storage.local.set({ conversations }).then(() => {
        console.log('[SidePanelApp] ✅ Conversations saved successfully');
      }).catch((error) => {
        console.error('[SidePanelApp] ❌ Failed to save conversations:', error);
      });
    } else {
      console.log('[SidePanelApp] No conversations to save (empty object)');
    }
  }, [conversations]);

  // Persistence: Save pending operations when they change
  useEffect(() => {
    if (Object.keys(pendingOperations).length > 0) {
      console.log('[SidePanelApp] Saving pending operations to storage:', Object.keys(pendingOperations));
      browser.storage.local.set({ pendingOperations }).then(() => {
        console.log('[SidePanelApp] ✅ Pending operations saved successfully');
      }).catch((error) => {
        console.error('[SidePanelApp] ❌ Failed to save pending operations:', error);
      });
    } else {
      // Clear pending operations from storage when empty
      browser.storage.local.remove(['pendingOperations']).catch((error) => {
        console.warn('[SidePanelApp] Failed to clear pending operations from storage:', error);
      });
    }
  }, [pendingOperations]);

  // DEFENSIVE: State integrity validation
  useEffect(() => {
    const currentState = {
      conversations,
      conversationTitles,
      optimisticCases
    };

    const isValid = validateStateIntegrity(currentState, 'SidePanelApp');

    if (!isValid) {
      console.error('[SidePanelApp] 🚨 CRITICAL: State integrity violation detected!');
      debugDataSeparation(optimisticCases, 'OptimisticCases');
      debugDataSeparation(Object.keys(conversations), 'ConversationKeys');
      debugDataSeparation(Object.keys(conversationTitles), 'TitleKeys');
    }
  }, [conversations, conversationTitles, optimisticCases]);

  // Persistence: Save optimistic cases when they change
  useEffect(() => {
    if (optimisticCases.length > 0) {
      console.log('[SidePanelApp] Saving optimistic cases to storage:', optimisticCases.length);
      browser.storage.local.set({ optimisticCases }).then(() => {
        console.log('[SidePanelApp] ✅ Optimistic cases saved successfully');
      }).catch((error) => {
        console.error('[SidePanelApp] ❌ Failed to save optimistic cases:', error);
      });
    } else {
      // Clear optimistic cases from storage when empty
      browser.storage.local.remove(['optimisticCases']).catch((error) => {
        console.warn('[SidePanelApp] Failed to clear optimistic cases from storage:', error);
      });
    }
  }, [optimisticCases]);

  // Persistence: Save pinned cases when they change
  useEffect(() => {
    const pinnedArray = Array.from(pinnedCases);
    console.log('[SidePanelApp] 📌 Saving pinned cases to storage:', pinnedArray.length);
    browser.storage.local.set({ pinnedCases: pinnedArray }).then(() => {
      console.log('[SidePanelApp] ✅ Pinned cases saved successfully');
    }).catch((error) => {
      console.error('[SidePanelApp] ❌ Failed to save pinned cases:', error);
    });
  }, [pinnedCases]);

  // Persistence: Save ID mappings when they change
  useEffect(() => {
    const mappings = idMappingManager.getState();
    if (mappings.optimisticToReal.size > 0 || mappings.realToOptimistic.size > 0) {
      const serializableMappings = {
        optimisticToReal: Object.fromEntries(mappings.optimisticToReal),
        realToOptimistic: Object.fromEntries(mappings.realToOptimistic)
      };
      console.log('[SidePanelApp] Saving ID mappings to storage:', serializableMappings);
      browser.storage.local.set({ idMappings: serializableMappings }).then(() => {
        console.log('[SidePanelApp] ✅ ID mappings saved successfully');
      }).catch((error) => {
        console.error('[SidePanelApp] ❌ Failed to save ID mappings:', error);
      });
    }
  }, [conversations, conversationTitles]); // Trigger when conversations or titles change as they affect ID mappings

  useEffect(() => {
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const initializeSession = async () => {
      try {
        // Check authentication state using new AuthManager
        const isAuth = await authManager.isAuthenticated();
        setIsAuthenticated(isAuth);

        if (isAuth) {
          // Get session from storage (session management unchanged)
          try {
            const stored = await browser.storage.local.get(["sessionId", "sessionResumed", "sessionCreatedAt"]);
            if (stored?.sessionId) {
              setSessionId(stored.sessionId);
              console.log('[SidePanelApp] Auth and session initialized:', {
                authenticated: true,
                sessionId: stored.sessionId?.slice(0, 8) + '...',
                resumed: stored.sessionResumed || false
              });
            } else {
              // Authenticated but no session - start fresh
              setSessionId(null);
              setHasUnsavedNewChat(false);
            }
          } catch (error) {
            console.warn('[SidePanelApp] Session retrieval error:', error);
            setSessionId(null);
            setHasUnsavedNewChat(false);
          }
        } else {
          // Not authenticated - clear any stale session data
          setSessionId(null);
          setHasUnsavedNewChat(false);
          await browser.storage.local.remove(["sessionId", "sessionCreatedAt", "sessionResumed", "clientId"]);
          return;
        }

        // Do not auto-load sessions list; UI is case-driven
        // Error cleared
      } catch (err) {
        console.error('[SidePanelApp] Error initializing session:', err);
        if (err instanceof AuthenticationError) {
          // Authentication expired, clear state and show login
          setIsAuthenticated(false);
          setSessionId(null);
          setAuthError('Session expired - please sign in again');
        } else {
          showError("Unable to connect to FaultMaven server. Please check your connection and try again.");
          setSessionId(null);
          setHasUnsavedNewChat(false);
        }
      }
    };

    // Listen for cross-tab auth state changes
    const handleMessage = (message: any) => {
      if (message.type === 'auth_state_changed') {
        if (message.authState === null) {
          // Logged out in another tab
          setIsAuthenticated(false);
          setSessionId(null);
          setHasUnsavedNewChat(true);
        }
      }
    };

    // Setup cross-tab messaging
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.onMessage.addListener(handleMessage);
    }

    initializeSession();
    
    // Cleanup interval on unmount
    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    };
  }, []);

  // Handle responsive design
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 600) {
        setSidebarCollapsed(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // PERFORMANCE OPTIMIZATION: Periodic memory cleanup
  // Runs every 5 minutes to clean up old conversations and prevent memory leaks
  useEffect(() => {
    const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

    const cleanupInterval = setInterval(() => {
      console.log('[SidePanelApp] 🧹 Running periodic memory cleanup...');

      // Get cases with failed operations (never delete these)
      const failedOps = pendingOpsManager.getByStatus('failed');
      const casesWithFailedOps = new Set(
        failedOps.map(op => op.optimisticData?.caseId || op.optimisticData?.case_id).filter(Boolean)
      );

      // Clean up conversations
      setConversations(prev => {
        // Get memory stats before cleanup
        const statsBefore = memoryManager.getMemoryStats(prev);
        console.log('[SidePanelApp] Memory stats before cleanup:', statsBefore);

        // Clean up old conversations
        const cleanedConversations = memoryManager.cleanupConversations(
          prev,
          activeCaseId,
          casesWithFailedOps
        );

        // Clean up messages in remaining conversations
        const finalCleaned: Record<string, OptimisticConversationItem[]> = {};
        Object.keys(cleanedConversations).forEach(caseId => {
          finalCleaned[caseId] = memoryManager.cleanupConversation(cleanedConversations[caseId]);
        });

        // Get stats after cleanup
        const statsAfter = memoryManager.getMemoryStats(finalCleaned);
        console.log('[SidePanelApp] Memory stats after cleanup:', statsAfter);
        console.log('[SidePanelApp] ✅ Memory cleanup complete:', {
          conversationsRemoved: statsBefore.totalConversations - statsAfter.totalConversations,
          messagesRemoved: statsBefore.totalMessages - statsAfter.totalMessages
        });

        return finalCleaned;
      });
    }, CLEANUP_INTERVAL);

    return () => clearInterval(cleanupInterval);
  }, [activeCaseId]); // Re-create interval when active case changes

  const handleLogin = async () => {
    setAuthError(null);
    if (!loginUsername || loginUsername.trim().length < 3) {
      setAuthError("Username must be at least 3 characters");
      return;
    }
    setLoggingIn(true);
    try {
      const auth = await devLogin(loginUsername.trim());
      const sid = auth.session_id;

      if (sid) {
        // Store session ID (auth token is handled by AuthManager in devLogin)
        await browser.storage.local.set({
          sessionId: sid,
          sessionCreatedAt: Date.now()
        });
        setIsAuthenticated(true);
        setSessionId(sid);
        setHasUnsavedNewChat(false);
        setRefreshSessions(prev => prev + 1);
      } else {
        setAuthError("Login response missing session_id");
      }
    } catch (e: any) {
      // Use error handler to show toast notification
      showError(e, {
        operation: 'login',
        metadata: { username: loginUsername }
      });

      // Set inline error message in login form
      // The error from devLogin is already user-friendly
      setAuthError(e?.message || "Login failed. Please try again.");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAuth(); // This also clears auth state via AuthManager
    } catch (error) {
      console.warn('[SidePanelApp] Logout error:', error);
      // Clear auth state even if logout request fails
      await authManager.clearAuthState();
    }

    // Clear session data but preserve conversations/titles for persistence
    await browser.storage.local.remove([
      "sessionId", "sessionCreatedAt", "sessionResumed", "clientId"
    ]);
    setIsAuthenticated(false);
    setSessionId(null);
    setHasUnsavedNewChat(true);
    // Clear session-related state but keep conversations/titles
    setActiveCaseId(undefined);
    setActiveCase(null);
    // Note: Keep conversationTitles and conversations for persistence across logins
  };

  const handleSessionSelect = (selectedSessionId: string) => {
    if (selectedSessionId && typeof selectedSessionId === 'string') {
      setSessionId(selectedSessionId);
      setHasUnsavedNewChat(false);
      // Update storage to remember the last active session
      browser.storage.local.set({ sessionId: selectedSessionId }).catch(() => {});
    }
  };

  const handleCaseSelect = async (caseId: string) => {
    setActiveCaseId(caseId);
    setHasUnsavedNewChat(false);
    setActiveTab('copilot'); // Switch to copilot view when selecting a conversation

    try {
      // ARCHITECTURAL FIX: Resolve optimistic IDs to real IDs for API calls
      // If this is an optimistic case, check if we have a real ID mapping
      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;

      console.log('[SidePanelApp] Case selection - ID resolution:', {
        selectedId: caseId,
        resolvedId: resolvedCaseId,
        isOptimistic: isOptimisticId(caseId)
      });

      // Use existing activeCase if it matches, or create minimal case object
      if (activeCase && activeCase.case_id === caseId) {
        // Already have the correct case selected
      } else {
        // Create minimal case object to avoid unnecessary API call
        const minimalCase: UserCase = {
          case_id: caseId,
          title: conversationTitles[caseId] || 'Loading...',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          message_count: 0
        };
        setActiveCase(minimalCase);
      }

      // ARCHITECTURAL FIX: Check for conversation data under both selected and resolved IDs
      // This prevents unnecessary API calls after ID reconciliation
      const hasConversationData = conversations[caseId] || conversations[resolvedCaseId];

      if (!hasConversationData) {
        setLoading(true);

        // For optimistic cases that haven't been reconciled yet, use local data
        if (isOptimisticId(caseId) && !idMappingManager.getRealId(caseId)) {
          console.log('[SidePanelApp] Using local conversation data for unreconciled optimistic case:', caseId);
          // The conversation should already exist in local state from optimistic updates
          setLoading(false);
          return;
        }

        console.log('[SidePanelApp] Loading fresh conversation data from backend:', {
          selectedId: caseId,
          resolvedId: resolvedCaseId,
          reason: 'No cached data found'
        });

        const conversationData = await getCaseConversation(resolvedCaseId);
        const messages = conversationData.messages || [];
        const backendMessages: OptimisticConversationItem[] = messages.map((msg: any) => {
          // Transform backend Message format to ChatWindow ConversationItem format
          // Backend: { message_id, role: 'user'|'agent', content, created_at }
          // Frontend: { id, question?, response?, timestamp }
          const transformed: OptimisticConversationItem = {
            id: msg.message_id,
            timestamp: msg.created_at,
            optimistic: false,
            originalId: msg.message_id
          };

          // Map role + content to question/response based on role
          if (msg.role === 'user') {
            transformed.question = msg.content;
          } else if (msg.role === 'agent' || msg.role === 'assistant') {
            transformed.response = msg.content;
          }

          return transformed;
        });

        // ARCHITECTURAL FIX: Merge backend data with existing local data
        // This preserves AI responses that haven't been saved to backend yet
        setConversations(prev => {
          const existingMessages = prev[caseId] || [];

          // Create a map of backend messages by ID for efficient lookup
          const backendMessageMap = new Map(backendMessages.map(msg => [msg.id, msg]));

          // Merge: Keep existing local messages, update with backend versions where available
          const mergedMessages = existingMessages.map(localMsg => {
            const backendVersion = backendMessageMap.get(localMsg.id);
            if (backendVersion) {
              // Use backend version (more authoritative)
              console.log('[SidePanelApp] Updating local message with backend version:', localMsg.id);
              return backendVersion;
            }
            // Keep local version (e.g., AI responses not yet in backend)
            return localMsg;
          });

          // Add any backend messages that aren't in local state
          const localMessageIds = new Set(existingMessages.map(msg => msg.id));
          const newBackendMessages = backendMessages.filter(msg => !localMessageIds.has(msg.id));

          if (newBackendMessages.length > 0) {
            console.log('[SidePanelApp] Adding new backend messages:', newBackendMessages.length);
          }

          const finalMessages = [...mergedMessages, ...newBackendMessages];

          console.log('[SidePanelApp] Conversation merge complete:', {
            caseId,
            existing: existingMessages.length,
            backend: backendMessages.length,
            final: finalMessages.length
          });

          return {
            ...prev,
            [caseId]: finalMessages
          };
        });
        setLoading(false);
      } else {
        // ARCHITECTURAL FIX: If conversation exists under resolved ID but not selected ID,
        // copy it to avoid missing conversations after reconciliation
        if (conversations[resolvedCaseId] && !conversations[caseId] && caseId !== resolvedCaseId) {
          console.log('[SidePanelApp] Copying conversation data from resolved ID to selected ID:', {
            from: resolvedCaseId,
            to: caseId,
            messageCount: conversations[resolvedCaseId].length
          });
          setConversations(prev => ({
            ...prev,
            [caseId]: prev[resolvedCaseId]
          }));
        }
      }
    } catch (error) {
      console.error('[SidePanelApp] Error loading case:', error);
      setLoading(false);
    }
  };

  const handleNewSession = async (newChatId: string) => {
    if (typeof newChatId === 'string') {
      if (newChatId === '') {
        // NEW CHAT: Set unsaved state - no case created yet
        console.log('[SidePanelApp] 🆕 Starting new unsaved chat...');

        // If there was already an unsaved new chat, it gets automatically cleaned up
        // by clearing the state (no persistence needed since it was never saved)
        if (hasUnsavedNewChat) {
          console.log('[SidePanelApp] 🧹 Cleaning up previous unused new chat');
        }

        // Clear any existing active case and enter "new unsaved chat" mode
        setActiveCaseId(undefined);
        setActiveCase(null);
        setHasUnsavedNewChat(true);

        console.log('[SidePanelApp] ✅ Ready for new chat - user can now type');
      } else {
        // Existing logic for session selection
        setSessionId(newChatId);
        setHasUnsavedNewChat(false);
        browser.storage.local.set({ sessionId: newChatId }).catch(() => {});
      }
    }
  };

  // Background case creation function - handles optimistic ID reconciliation
  const createOptimisticCaseInBackground = async (optimisticCaseId: string, title: string) => {
    try {
      console.log('[SidePanelApp] 🔄 Starting background case creation...', { optimisticCaseId, title });

      // Ensure we have a session with retry
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        console.log('[SidePanelApp] No session found, creating new session with retry...');

        const newSession = await retryWithBackoff(
          () => createSession(),
          {
            maxAttempts: 3,
            initialDelay: 1000,
            onRetry: (err, attempt, delay) => {
              console.log(`[SidePanelApp] Session creation attempt ${attempt} failed, retrying in ${delay}ms...`);
            }
          }
        );

        currentSessionId = newSession.session_id;
        setSessionId(currentSessionId);
        await browser.storage.local.set({
          sessionId: currentSessionId,
          sessionCreatedAt: Date.now()
        });
        console.log('[SidePanelApp] ✅ New session created:', currentSessionId);
      }

      // Create real case via API
      console.log('[SidePanelApp] 📡 Creating real case via API...', { sessionId: currentSessionId, title });
      const realCase = await createCase({
        session_id: currentSessionId,
        title: title
      });
      const realCaseId = realCase.case_id;

      console.log('[SidePanelApp] 🔍 RAW API RESPONSE from createCase:', JSON.stringify(realCase, null, 2));

      console.log('[SidePanelApp] ✅ Real case created:', { optimisticCaseId, realCaseId });

      // DEFENSIVE: Validate ID formats before mapping
      if (!isOptimisticId(optimisticCaseId)) {
        throw new Error(`ARCHITECTURE VIOLATION: Expected optimistic ID, got: ${optimisticCaseId}`);
      }
      if (!isRealId(realCaseId)) {
        throw new Error(`ARCHITECTURE VIOLATION: Expected real ID, got: ${realCaseId}`);
      }

      // ID Reconciliation: Map optimistic → real ID
      idMappingManager.addMapping(optimisticCaseId, realCaseId);
      console.log('[SidePanelApp] ✅ ID mapping validated and created:', { optimisticCaseId, realCaseId });

      // Don't move conversations here - let query submission handle ID reconciliation
      // This prevents the double-move issue that causes conversation loss

      // Update state with real case data
      setActiveCase(prev => prev?.case_id === optimisticCaseId ? {
        ...realCase,
        optimistic: false,
        originalId: optimisticCaseId
      } : prev);

      // Keep activeCaseId as optimistic for now - query submission will update it
      // This ensures UI continues to work with optimistic ID until reconciliation completes

      // Mark operation as completed
      pendingOpsManager.complete(optimisticCaseId);

      // Keep the optimistic case visible until we can confirm the backend refresh succeeded
      // We'll remove it when ConversationsList successfully loads the real case
      console.log('[SidePanelApp] ✅ Case creation completed - keeping optimistic case until backend refresh:', { optimisticCaseId, realCaseId });

      // Trigger refresh to load the real case from backend
      setRefreshSessions(prev => prev + 1);

    } catch (error) {
      console.error('[SidePanelApp] ❌ Background case creation failed:', error);

      // Mark operation as failed
      pendingOpsManager.fail(optimisticCaseId, error instanceof Error ? error.message : 'Unknown error');

      // Update optimistic case to show failed state
      setActiveCase(prev => prev?.case_id === optimisticCaseId ? {
        ...prev,
        failed: true
      } : prev);

      // Show error to user with retry option using error handler
      showErrorWithRetry(
        error,
        async () => {
          await createOptimisticCaseInBackground(optimisticCaseId, title);
        },
        {
          operation: 'create_case',
          metadata: { optimisticCaseId, title }
        }
      );
    }
  };

  // REINFORCED TITLE PROTECTION: Absolute precedence with source tracking
  const handleTitleGenerated = (sid: string, title: string, source: 'backend' | 'user' | 'system' = 'backend') => {
    console.log('[SidePanelApp] 📝 Title update requested:', { sid, title, source });

    setConversationTitles(prev => {
      const existingTitle = prev[sid];
      const existingSource = titleSources[sid];

      // REINFORCED PROTECTION RULES:
      // 1. User titles are NEVER overwritten by backend or system
      // 2. System titles can be overwritten by user but not backend
      // 3. Backend titles can be overwritten by user or system
      // 4. Empty/undefined titles can be set by anyone

      if (existingSource === 'user' && source !== 'user') {
        console.log('[SidePanelApp] 🛡️ ABSOLUTE PROTECTION: User title cannot be overwritten:', {
          existing: existingTitle,
          existingSource,
          newTitle: title,
          newSource: source,
          decision: 'REJECT'
        });
        return prev; // Absolutely protect user titles
      }

      // Allow backend to override system titles (timestamps) - this is the intended flow
      // Backend automatically provides better titles when it has enough context
      if (existingSource === 'system' && source === 'backend') {
        console.log('[SidePanelApp] 🔄 AUTO TITLE: Backend title replacing system title:', {
          existing: existingTitle,
          existingSource,
          newTitle: title,
          newSource: source,
          decision: 'ALLOW - automatic backend title generation'
        });
        // Allow the update - this is how automatic title generation works
      }

      // Allow the update
      console.log('[SidePanelApp] ✅ Title update APPROVED:', {
        sid,
        title,
        source,
        previousTitle: existingTitle,
        previousSource: existingSource
      });
      return { ...prev, [sid]: title };
    });

    // Update title source tracking
    setTitleSources(prev => ({ ...prev, [sid]: source }));
  };

  // OPTIMISTIC TITLE UPDATE: Immediate UI update with background sync
  const handleOptimisticTitleUpdate = async (caseId: string, newTitle: string) => {
    console.log('[SidePanelApp] 🚀 Optimistic title update:', { caseId, newTitle });

    // IMMEDIATE UI UPDATE (0ms response)
    handleTitleGenerated(caseId, newTitle, 'user');

    // Create pending operation for background sync
    const operationId = OptimisticIdGenerator.generate('opt_op');
    const pendingOperation: PendingOperation = {
      id: operationId,
      type: 'update_title',
      status: 'pending',
      optimisticData: { caseId, newTitle },
      rollbackFn: () => {
        console.log('[SidePanelApp] 🔄 Rolling back failed title update');
        // Could restore previous title, but for now just keep optimistic state
        // since title updates are usually reliable
      },
      retryFn: async () => {
        console.log('[SidePanelApp] 🔄 Retrying title update');
        await syncTitleToBackgroundInBackground(caseId, newTitle, operationId);
      },
      createdAt: Date.now()
    };

    pendingOpsManager.add(pendingOperation);

    // Background sync (non-blocking) with debouncing for performance
    // This prevents excessive API calls during rapid title edits
    debouncedTitleSync(caseId, newTitle, operationId);
  };

  // Background title sync function
  const syncTitleToBackgroundInBackground = async (caseId: string, title: string, operationId: string) => {
    try {
      console.log('[SidePanelApp] 🔄 Syncing title to backend...', { caseId, title });

      // Call the actual backend API to update the case title
      await updateCaseTitle(caseId, title);

      console.log('[SidePanelApp] ✅ Title sync completed successfully');
      pendingOpsManager.complete(operationId);

    } catch (error) {
      console.error('[SidePanelApp] ❌ Title sync failed:', error);
      pendingOpsManager.fail(operationId, error instanceof Error ? error.message : 'Unknown error');

      // Note: We don't rollback title changes since they're usually successful
      // and users expect their title changes to persist
    }
  };

  // PERFORMANCE OPTIMIZATION: Debounced title sync for rapid edits
  // Creates a debounced version that waits 1 second after the last edit
  // This prevents excessive API calls when user is typing rapidly
  const debouncedTitleSync = useRef(
    debounce(syncTitleToBackgroundInBackground, {
      wait: 1000, // Wait 1 second after last change
      maxWait: 3000 // Force sync after 3 seconds max
    })
  ).current;
  
  // OPTIMISTIC CASE DELETION: Clean up all state immediately
  const handleAfterDelete = (deletedCaseId: string, remaining: Array<{ case_id: string; updated_at?: string; created_at?: string }>) => {
    console.log('[SidePanelApp] 🗑️ Optimistic case deletion:', { deletedCaseId, remainingCount: remaining.length });

    // IMMEDIATE CLEANUP: Remove deleted case from optimistic state (0ms response)
    setConversations(prev => {
      const updated = { ...prev };
      delete updated[deletedCaseId];
      console.log('[SidePanelApp] ✅ Conversations cleaned up for deleted case:', deletedCaseId);
      return updated;
    });

    setConversationTitles(prev => {
      const updated = { ...prev };
      delete updated[deletedCaseId];
      console.log('[SidePanelApp] ✅ Conversation titles cleaned up for deleted case:', deletedCaseId);
      return updated;
    });

    setTitleSources(prev => {
      const updated = { ...prev };
      delete updated[deletedCaseId];
      console.log('[SidePanelApp] ✅ Title sources cleaned up for deleted case:', deletedCaseId);
      return updated;
    });

    // Clean up optimistic cases
    setOptimisticCases(prev => prev.filter(c => c.case_id !== deletedCaseId));

    // Clean up pinned state for deleted case
    setPinnedCases(prev => {
      const updated = new Set(prev);
      updated.delete(deletedCaseId);
      return updated;
    });

    // Clean up any pending operations for this case
    const currentOperations = pendingOpsManager.getAll();
    Object.values(currentOperations).forEach((operation: PendingOperation) => {
      if (operation.optimisticData?.caseId === deletedCaseId ||
          operation.optimisticData?.case_id === deletedCaseId) {
        console.log('[SidePanelApp] 🧹 Cleaning up pending operation for deleted case:', operation.id);
        pendingOpsManager.remove(operation.id);
      }
    });

    // Clear ID mappings for this case if it was optimistic
    if (OptimisticIdGenerator.isOptimistic(deletedCaseId)) {
      idMappingManager.removeMapping(deletedCaseId);
      console.log('[SidePanelApp] 🧹 Cleaned up ID mapping for optimistic case:', deletedCaseId);
    }

    // Handle navigation
    if (remaining && remaining.length > 0) {
      const sorted = [...remaining].sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
      setActiveCaseId(sorted[0].case_id);
      setHasUnsavedNewChat(false);
    } else {
      setActiveCaseId(undefined);
      setHasUnsavedNewChat(false); // keep locked until user clicks New Chat
    }

    setRefreshSessions(prev => prev + 1);
    console.log('[SidePanelApp] ✅ Case deletion cleanup completed');
  };

  // PIN/UNPIN: Toggle pin state for a case
  const handlePinToggle = (caseId: string) => {
    console.log('[SidePanelApp] 📌 Toggling pin for case:', caseId);
    setPinnedCases(prev => {
      const newSet = new Set(prev);
      if (newSet.has(caseId)) {
        newSet.delete(caseId);
        console.log('[SidePanelApp] 📍 Unpinned case:', caseId);
      } else {
        newSet.add(caseId);
        console.log('[SidePanelApp] 📌 Pinned case:', caseId);
      }
      return newSet;
    });
  };

  // Removed handleCaseActivated and handleCaseCommitted - no longer using pending mechanism

  // SINGLE SOURCE OF TRUTH: Action handlers for ChatWindow
  const handleQuerySubmit = async (query: string) => {
    if (!query.trim()) return;

    // Prevent multiple submissions
    if (submitting) {
      console.warn('[SidePanelApp] Query submission blocked - already submitting');
      return;
    }

    // Check authentication first
    const isAuth = await authManager.isAuthenticated();
    if (!isAuth) {
      console.error('[SidePanelApp] User not authenticated, cannot submit query');
      return;
    }

    console.log('[SidePanelApp] 🚀 OPTIMISTIC MESSAGE SUBMISSION START');

    // LOCK INPUT: Prevent multiple submissions (immediate feedback)
    setSubmitting(true);

    // OPTIMISTIC MESSAGE SUBMISSION: Immediate UI updates (0ms response)

    // Generate optimistic message IDs
    const userMessageId = OptimisticIdGenerator.generateMessageId();
    const aiMessageId = OptimisticIdGenerator.generateMessageId();
    const messageTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Ensure we have an active case (create optimistically if needed)
    let targetCaseId = activeCaseId;

    // If we're in "new unsaved chat" mode, create optimistic case immediately
    if (!targetCaseId && hasUnsavedNewChat) {
      console.log('[SidePanelApp] 🆕 Creating optimistic case for new unsaved chat with first question');

      // Generate optimistic case ID and timestamp title immediately
      const optimisticCaseId = OptimisticIdGenerator.generateCaseId();
      const chatTitle = IdUtils.generateChatTitle();
      const caseTimestamp = new Date().toISOString();

      // Create optimistic case object
      const optimisticCase: OptimisticUserCase = {
        case_id: optimisticCaseId,
        title: chatTitle,
        status: 'active',
        created_at: caseTimestamp,
        updated_at: caseTimestamp,
        message_count: 0,
        optimistic: true,
        failed: false,
        pendingOperationId: optimisticCaseId,
        originalId: optimisticCaseId
      };

      // IMMEDIATE UI UPDATE: Create optimistic case (0ms response)
      setActiveCaseId(optimisticCaseId);
      setActiveCase(optimisticCase);
      setOptimisticCases(prev => [...prev, optimisticCase]); // Add to optimistic cases list for ConversationsList
      setConversationTitles(prev => ({
        ...prev,
        [optimisticCaseId]: chatTitle
      }));
      setTitleSources(prev => ({
        ...prev,
        [optimisticCaseId]: 'system'
      }));
      setConversations(prev => ({
        ...prev,
        [optimisticCaseId]: [] // Empty conversation initially
      }));
      setHasUnsavedNewChat(false); // No longer "unsaved" - we have optimistic case

      targetCaseId = optimisticCaseId;

      // Register case creation operation for rollback/retry tracking
      const caseCreationOperation: PendingOperation = {
        id: optimisticCaseId,
        type: 'create_case',
        status: 'pending',
        optimisticData: { case_id: optimisticCaseId, title: chatTitle, timestamp: caseTimestamp },
        rollbackFn: () => {
          console.log('[SidePanelApp] 🔄 Rolling back failed case creation');
          // Remove optimistic case from all state
          setActiveCaseId(undefined);
          setActiveCase(null);
          setOptimisticCases(prev => prev.filter(c => c.case_id !== optimisticCaseId)); // Remove from optimistic cases
          setConversationTitles(prev => {
            const updated = { ...prev };
            delete updated[optimisticCaseId];
            return updated;
          });
          setTitleSources(prev => {
            const updated = { ...prev };
            delete updated[optimisticCaseId];
            return updated;
          });
          setConversations(prev => {
            const updated = { ...prev };
            delete updated[optimisticCaseId];
            return updated;
          });
          // Clear ID mapping
          idMappingManager.removeMapping(optimisticCaseId);
          // Return to "unsaved new chat" state
          setHasUnsavedNewChat(true);
        },
        retryFn: async () => {
          console.log('[SidePanelApp] 🔄 Retrying case creation');
          await createOptimisticCaseInBackground(optimisticCaseId, chatTitle);
        },
        createdAt: Date.now()
      };

      pendingOpsManager.add(caseCreationOperation);

      // Background API call (non-blocking) - will reconcile IDs later
      createOptimisticCaseInBackground(optimisticCaseId, chatTitle);

      console.log('[SidePanelApp] ✅ Optimistic case created for new chat:', optimisticCaseId);
    }

    if (!targetCaseId) {
      console.log('[SidePanelApp] No active case and not in new chat mode');
      showError('Please click "New Chat" first');
      setSubmitting(false);
      return;
    }

    console.log('[SidePanelApp] ✨ Creating optimistic messages:', { userMessageId, aiMessageId, targetCaseId });

    // IMMEDIATE UI UPDATE 1: Add user message to conversation (0ms)
    const userMessage: OptimisticConversationItem = {
      id: userMessageId,
      question: query,
      response: '',
      error: false,
      timestamp: messageTimestamp,
      optimistic: true,
      loading: false,
      failed: false,
      pendingOperationId: userMessageId,
      originalId: userMessageId
    };

    // IMMEDIATE UI UPDATE 2: Add AI "thinking" message (0ms)
    const aiThinkingMessage: OptimisticConversationItem = {
      id: aiMessageId,
      question: '',
      response: '',  // Empty - visual indicator shows "Thinking..." dynamically
      error: false,
      timestamp: messageTimestamp,
      optimistic: true,
      loading: true,
      failed: false,
      pendingOperationId: aiMessageId,
      originalId: aiMessageId
    };

    // Update conversation immediately
    setConversations(prev => ({
      ...prev,
      [targetCaseId]: [...(prev[targetCaseId] || []), userMessage, aiThinkingMessage]
    }));

    console.log('[SidePanelApp] ✅ Messages added to UI immediately - 0ms response time');

    // Create pending operation for tracking
    const pendingOperation: PendingOperation = {
      id: aiMessageId,
      type: 'submit_query',
      status: 'pending',
      optimisticData: { userMessage, aiThinkingMessage, query, caseId: targetCaseId },
      rollbackFn: () => {
        console.log('[SidePanelApp] 🔄 Rolling back failed message submission');
        setConversations(prev => ({
          ...prev,
          [targetCaseId]: (prev[targetCaseId] || []).filter(
            item => item.id !== userMessageId && item.id !== aiMessageId
          )
        }));
      },
      retryFn: async () => {
        console.log('[SidePanelApp] 🔄 Retrying message submission');
        await submitOptimisticQueryInBackground(query, targetCaseId, userMessageId, aiMessageId);
      },
      createdAt: Date.now()
    };

    pendingOpsManager.add(pendingOperation);

    // Background API submission (non-blocking)
    submitOptimisticQueryInBackground(query, targetCaseId, userMessageId, aiMessageId);
  };

  // Background query submission function
  const submitOptimisticQueryInBackground = async (
    query: string,
    caseId: string,
    userMessageId: string,
    aiMessageId: string
  ) => {
    try {
      console.log('[SidePanelApp] 🔄 Starting background query submission...', { query: query.substring(0, 50), caseId });

      // Ensure we have a session
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        console.log('[SidePanelApp] No session found, creating new session...');
        const newSession = await createSession();
        currentSessionId = newSession.session_id;
        setSessionId(currentSessionId);
        await browser.storage.local.set({
          sessionId: currentSessionId,
          sessionCreatedAt: Date.now()
        });
        console.log('[SidePanelApp] ✅ New session created:', currentSessionId);
      }

      // Resolve optimistic ID to real ID if needed
      let resolvedCaseId = caseId;
      if (OptimisticIdGenerator.isOptimistic(caseId)) {
        console.log('[SidePanelApp] 🔄 Optimistic ID detected, waiting for reconciliation...', caseId);

        // Wait for ID reconciliation (with timeout)
        let attempts = 0;
        const maxAttempts = 30; // 15 seconds max wait (500ms * 30)

        while (attempts < maxAttempts) {
          const realId = idMappingManager.getRealId(caseId);
          if (realId) {
            resolvedCaseId = realId;
            console.log('[SidePanelApp] ✅ ID reconciliation found:', { optimistic: caseId, real: realId });
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }

        if (OptimisticIdGenerator.isOptimistic(resolvedCaseId)) {
          throw new Error('Timeout waiting for case ID reconciliation');
        }
      }

      // Submit query to case via API using real ID
      console.log('[SidePanelApp] 📡 Submitting query to case via API...', { caseId: resolvedCaseId, sessionId: currentSessionId });

      const queryRequest: QueryRequest = {
        session_id: currentSessionId,
        query: query.trim(),
        priority: 'low',
        context: {}
      };

      const response = await submitQueryToCase(resolvedCaseId, queryRequest);
      console.log('[SidePanelApp] ✅ Query submitted successfully, response type:', response.response_type);

      // Update investigation progress from view_state (OODA Framework v3.2.0)
      if (response.view_state && response.view_state.investigation_progress) {
        setInvestigationProgress(prev => ({
          ...prev,
          [resolvedCaseId]: response.view_state!.investigation_progress
        }));
        console.log('[SidePanelApp] 🔍 Investigation progress updated:', response.view_state.investigation_progress);
      }

      // Update conversations: replace optimistic messages with real data
      setConversations(prev => {
        const currentConversation = prev[caseId] || [];
        let updated = currentConversation.map(item => {
          if (item.id === userMessageId) {
            // Update user message to confirmed state
            return {
              ...item,
              optimistic: false,
              originalId: userMessageId
            };
          } else if (item.id === aiMessageId) {
            // Replace AI thinking message with real response
            return {
              ...item,
              response: response.content,
              responseType: response.response_type,
              confidenceScore: response.confidence_score,
              sources: response.sources,
              // v3.1.0 Evidence-centric fields
              evidenceRequests: response.evidence_requests,
              investigationMode: response.investigation_mode,
              caseStatus: response.case_status,
              // v3.0.0 fields (RE-ENABLED in v3.2.0)
              suggestedActions: response.suggested_actions,
              // v3.2.0 OODA Response Format fields
              clarifyingQuestions: response.clarifying_questions,
              suggestedCommands: response.suggested_commands,
              commandValidation: response.command_validation,
              problemDetected: response.problem_detected,
              problemSummary: response.problem_summary,
              severity: response.severity,
              scopeAssessment: response.scope_assessment,
              // Legacy fields
              plan: response.plan,
              nextActionHint: response.next_action_hint,
              requiresAction: response.response_type === 'CONFIRMATION_REQUEST' || response.response_type === 'CLARIFICATION_REQUEST',
              optimistic: false,
              loading: false,
              originalId: aiMessageId
            };
          }
          return item;
        });

        // Handle ID reconciliation: move conversation from optimistic to real ID if needed
        if (resolvedCaseId !== caseId) {
          console.log('[SidePanelApp] 🔄 Moving conversation from optimistic ID to real ID:', { from: caseId, to: resolvedCaseId });

          // CONFLICT DETECTION: Check for potential conflicts during ID reconciliation
          const currentPendingOps = pendingOpsManager.getAll();
          const conflict = conflictResolver.detectConflict(
            { conversations: prev[caseId], caseId },
            { conversations: updated, caseId: resolvedCaseId },
            {
              caseId: resolvedCaseId,
              operationType: 'id_reconciliation',
              pendingOperations: Object.values(currentPendingOps)
            }
          );

          if (conflict.hasConflict) {
            console.warn('[SidePanelApp] ⚠️ Conflict detected during ID reconciliation:', conflict);

            // Create backup before reconciliation
            const backupId = conflictResolver.createBackup(
              { optimistic: prev[caseId], real: updated },
              conflict
            );

            // Get resolution strategy
            const strategy = conflictResolver.getResolutionStrategy(conflict);

            if (strategy.strategy === 'backup_and_retry') {
              console.log('[SidePanelApp] 🔄 Applying backup_and_retry strategy for conflict resolution');

              // Use merge strategies to intelligently combine the data
              const mergeContext: MergeContext = {
                caseId: resolvedCaseId,
                timestamp: Date.now(),
                source: 'optimistic'
              };

              const mergeResult = MergeStrategies.mergeConversations(
                prev[caseId] || [],
                updated || [],
                mergeContext
              );

              if (mergeResult.requiresUserInput) {
                console.warn('[SidePanelApp] ⚠️ Merge requires user input - showing conflict resolution modal');

                // Show conflict resolution modal and wait for user choice
                showConflictResolution(conflict, prev[caseId], updated, mergeResult)
                  .then((resolution) => {
                    console.log('[SidePanelApp] ✅ User selected resolution:', resolution);

                    // Apply the user's choice
                    setConversations(currentPrev => {
                      let finalData: OptimisticConversationItem[] = (updated || []).map(item => ({
                        ...item,
                        optimistic: false,
                        loading: false,
                        failed: false,
                        originalId: item.id
                      }));

                      switch (resolution.choice) {
                        case 'keep_local':
                          finalData = prev[caseId] || [];
                          break;
                        case 'accept_remote':
                          finalData = (updated || []).map(item => ({
                            ...item,
                            optimistic: false,
                            loading: false,
                            failed: false,
                            originalId: item.id
                          }));
                          break;
                        case 'use_merged':
                          finalData = (mergeResult.merged || []).map(item => ({
                            ...item,
                            optimistic: false,
                            loading: false,
                            failed: false,
                            originalId: item.id
                          }));
                          break;
                        case 'restore_backup':
                          if (resolution.backupId) {
                            const restoredData = conflictResolver.restoreFromBackup(resolution.backupId);
                            if (restoredData) finalData = restoredData;
                          }
                          break;
                      }

                      // Apply the ID reconciliation with chosen data
                      const newState = { ...currentPrev };
                      newState[resolvedCaseId] = finalData;
                      if (currentPrev[caseId]) {
                        delete newState[caseId];
                      }
                      return newState;
                    });

                    // Also update activeCaseId and titles
                    setActiveCaseId(resolvedCaseId);
                    setConversationTitles(titlePrev => {
                      if (titlePrev[caseId]) {
                        const titleUpdated = { ...titlePrev };
                        titleUpdated[resolvedCaseId] = titlePrev[caseId];
                        delete titleUpdated[caseId];
                        return titleUpdated;
                      }
                      return titlePrev;
                    });

                    setTitleSources(sourcePrev => {
                      if (sourcePrev[caseId]) {
                        const sourceUpdated = { ...sourcePrev };
                        sourceUpdated[resolvedCaseId] = sourcePrev[caseId];
                        delete sourceUpdated[caseId];
                        return sourceUpdated;
                      }
                      return sourcePrev;
                    });
                  });

                return prev; // Return current state while modal is shown
              }

              console.log('[SidePanelApp] ✅ Automatic merge successful:', mergeResult);
              // Use merged conversation data
              const mergedData = mergeResult.merged.map(item => ({
                ...item,
                optimistic: false,
                loading: false,
                failed: false,
                originalId: item.id
              }));
              updated = mergedData as any; // Temporarily cast for compatibility

            } else if (!conflict.autoResolvable) {
              console.warn('[SidePanelApp] ⚠️ Manual conflict resolution required');
              showError(`Data conflict detected: ${strategy.userPrompt || 'Please refresh to resolve.'}`);
              return prev; // Abort reconciliation for manual resolution
            }
          }

          // Move conversation data
          const newState = { ...prev };
          newState[resolvedCaseId] = updated;
          if (prev[caseId]) {
            delete newState[caseId]; // Remove optimistic entry
          }

          // Update activeCaseId to real ID now that conversation is moved
          setActiveCaseId(resolvedCaseId);

          // Note: Don't remove optimistic case here - let backend-based cleanup handle it
          // to avoid timing gaps where no cases are visible in ConversationsList

          // Also move titles and title sources

          setConversationTitles(titlePrev => {
            if (titlePrev[caseId]) {
              const titleUpdated = { ...titlePrev };
              let titleToMove = titlePrev[caseId];

              // Simple ID reconciliation - title should already be correct

              titleUpdated[resolvedCaseId] = titleToMove;
              delete titleUpdated[caseId];
              return titleUpdated;
            }
            return titlePrev;
          });

          setTitleSources(sourcePrev => {
            if (sourcePrev[caseId]) {
              const sourceUpdated = { ...sourcePrev };
              const sourceToMove = sourcePrev[caseId];

              sourceUpdated[resolvedCaseId] = sourceToMove;
              delete sourceUpdated[caseId];
              return sourceUpdated;
            }
            return sourcePrev;
          });

          return newState;
        } else {
          // No ID reconciliation needed - title should already be correct

          return {
            ...prev,
            [resolvedCaseId]: updated
          };
        }
      });

      // Update case title if backend provides one (but respect local titles)
      if (response.metadata?.case_title) {
        handleTitleGenerated(resolvedCaseId, response.metadata.case_title, 'backend');
      }

      // Mark operation as completed
      pendingOpsManager.complete(aiMessageId);

      console.log('[SidePanelApp] ✅ Message submission completed and UI updated');

      // Note: Optimistic case cleanup is handled by the onCasesLoaded callback
      // This ensures cleanup only happens AFTER the real case appears in backend response
      // to prevent timing gaps where no cases are visible in ConversationsList

    } catch (error) {
      console.error('[SidePanelApp] ❌ Background query submission failed:', error);

      // Mark operation as failed
      pendingOpsManager.fail(aiMessageId, error instanceof Error ? error.message : 'Unknown error');

      // Update AI message to show error state
      setConversations(prev => {
        const currentConversation = prev[caseId] || [];
        const updated = currentConversation.map(item => {
          if (item.id === aiMessageId) {
            return {
              ...item,
              response: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Please try again.`,
              error: true,
              optimistic: false,
              loading: false,
              failed: true
            };
          }
          return item;
        });

        return {
          ...prev,
          [caseId]: updated
        };
      });

      // Show error to user with retry option using error handler
      showErrorWithRetry(
        error,
        async () => {
          await submitOptimisticQueryInBackground(query, caseId, userMessageId, aiMessageId);
        },
        {
          operation: 'message_submission',
          metadata: { caseId, query: query.substring(0, 50) }
        }
      );

    } finally {
      // UNLOCK INPUT: Always unlock input when submission completes (success or failure)
      setSubmitting(false);
      console.log('[SidePanelApp] 🔓 Input unlocked - submission completed');
    }
  };

  // Helper function to format file size in human-readable format
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleDataUpload = async (
    data: string | File,
    dataSource: "text" | "file" | "page"
  ): Promise<{ success: boolean; message: string }> => {
    try {
      setLoading(true);

      if (!activeCaseId || !sessionId) {
        return {
          success: false,
          message: "Please create a case first"
        };
      }

      // Convert text/page data to File if needed
      let fileToUpload: File;
      if (data instanceof File) {
        fileToUpload = data;
      } else {
        // Convert string data to File
        const blob = new Blob([data], { type: 'text/plain' });
        const filename = dataSource === 'page' ? 'page-content.txt' : 'text-data.txt';
        fileToUpload = new File([blob], filename, { type: 'text/plain' });
      }

      // Create source metadata based on data source
      const sourceMetadata: SourceMetadata = {
        source_type: dataSource === 'file' ? 'file_upload'
                   : dataSource === 'page' ? 'page_capture'
                   : 'text_paste'
      };

      // For page captures, we could enhance this with URL capture in the future
      // if (dataSource === 'page' && currentPageUrl) {
      //   sourceMetadata.source_url = currentPageUrl;
      //   sourceMetadata.captured_at = new Date().toISOString();
      // }

      // Upload to backend with source metadata
      const uploadResponse = await uploadDataToCase(
        activeCaseId,
        sessionId,
        fileToUpload,
        sourceMetadata
      );

      // Generate user upload message
      const userMessage: OptimisticConversationItem = {
        id: `upload-${Date.now()}`,
        question: `📎 Uploaded: ${uploadResponse.file_name || fileToUpload.name} (${formatBytes(uploadResponse.file_size || 0)})`,
        timestamp: new Date().toISOString(),
        optimistic: false
      };

      // Generate AI response from backend (or fallback message)
      const aiMessage: OptimisticConversationItem = {
        id: `response-${Date.now()}`,
        response: uploadResponse.agent_response?.content || "Data uploaded and processed successfully.",
        timestamp: new Date().toISOString(),
        responseType: uploadResponse.agent_response?.response_type,
        confidenceScore: uploadResponse.agent_response?.confidence_score,
        sources: uploadResponse.agent_response?.sources,
        // v3.1.0 Evidence-centric fields
        evidenceRequests: uploadResponse.agent_response?.evidence_requests,
        investigationMode: uploadResponse.agent_response?.investigation_mode,
        caseStatus: uploadResponse.agent_response?.case_status,
        // DEPRECATED v3.0.0 (backward compatibility)
        suggestedActions: uploadResponse.agent_response?.suggested_actions,
        optimistic: false
      };

      // Update conversation with both messages
      setConversations(prev => ({
        ...prev,
        [activeCaseId]: [...(prev[activeCaseId] || []), userMessage, aiMessage]
      }));

      console.log('[SidePanelApp] Data upload completed with conversation messages:', {
        userMessage: userMessage.question,
        aiResponse: aiMessage.response?.substring(0, 100)
      });

      return {
        success: true,
        message: ""  // No toast message needed - feedback is in conversation
      };
    } catch (error) {
      console.error('[SidePanelApp] Data upload error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Upload failed';
      return {
        success: false,
        message: `Upload failed: ${errorMsg}`
      };
    } finally {
      setLoading(false);
    }
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  // Handle document viewing from sources
  const handleDocumentView = async (documentId: string) => {
    try {
      const document = await getKnowledgeDocument(documentId);
      setViewingDocument(document);
      setIsDocumentModalOpen(true);
      setActiveTab('kb');
    } catch {
      // noop
    }
  };

  // Login screen
  const renderLogin = () => (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white border border-gray-200 rounded-lg p-6 w-full max-w-sm shadow-sm">
        <div className="text-center mb-4">
          <img src="/icon/square-light.svg" alt="FaultMaven" className="w-12 h-12 mx-auto mb-2" />
          <h2 className="text-base font-semibold text-gray-800">Sign in (Dev)</h2>
          <p className="text-xs text-gray-500">Use your email to start a session</p>
        </div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
        <input
          type="text"
          value={loginUsername}
          onChange={(e) => setLoginUsername(e.target.value)}
          placeholder="Enter your username"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={loggingIn}
        />
        {authError && (
          <div className="text-xs text-red-600 mt-2">{authError}</div>
        )}
        <div className="mt-4">
          <button
            onClick={handleLogin}
            disabled={loggingIn || !loginUsername}
            className="w-full px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );

  // Auth gate
  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <div className="flex h-screen bg-gray-50 text-gray-800 text-sm font-sans">
          {renderLogin()}
        </div>
      </ErrorBoundary>
    );
  }

  // Render the collapsible sidebar
  const renderSidebar = () => {
    return (
      <div className={`flex-shrink-0 bg-white border-r border-gray-200 transition-all duration-300 ${
        sidebarCollapsed ? 'w-16' : 'w-72 max-w-72'
      }`}>
        {sidebarCollapsed ? (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
              <div className="flex items-center justify-center">
                <img
                  src="/icon/design-light.svg"
                  alt="FaultMaven Logo"
                  className="h-8 w-auto"
                />
              </div>
            </div>
            <div className="flex-1 p-3 space-y-3">
              <button
                onClick={() => handleNewSession('')}
                disabled={hasUnsavedNewChat}
                className="w-full h-10 flex items-center justify-center bg-blue-300 text-white rounded-lg hover:bg-blue-400 transition-colors disabled:opacity-50"
                title="New Chat"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                onClick={toggleSidebar}
                className="w-full h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Expand Sidebar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="flex-shrink-0 p-3 border-t border-gray-200">
              <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src="/icon/design-light.svg"
                    alt="FaultMaven Logo"
                    className="h-8 w-auto"
                  />
                  <h1 className="text-lg font-semibold text-gray-900">FaultMaven</h1>
                </div>
                <button
                  onClick={toggleSidebar}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Collapse Sidebar"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>

            </div>
            <div className="flex-shrink-0 px-4 py-2 space-y-2">
              <button
                onClick={() => {
                  setActiveTab('kb');
                  setHasUnsavedNewChat(false);
                }}
                className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-lg transition-colors ${
                  activeTab === 'kb'
                    ? 'bg-blue-300 text-white hover:bg-blue-400'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="Knowledge Base"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span className="text-sm font-medium">Knowledge Base</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('copilot');
                  handleNewSession('');
                }}
                className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-lg transition-colors ${
                  activeTab === 'copilot'
                    ? 'bg-blue-300 text-white hover:bg-blue-400'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="Start new conversation"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm font-medium">New Chat</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary
                fallback={
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg m-4">
                    <p className="text-sm text-red-700">Error loading conversations</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Retry
                    </button>
                  </div>
                }
              >
                <ConversationsList
                  activeSessionId={sessionId || undefined}
                  activeCaseId={activeCaseId}
                  onCaseSelect={handleCaseSelect}
                  onNewSession={handleNewSession}
                  conversationTitles={conversationTitles}
                  hasUnsavedNewChat={hasUnsavedNewChat}
                  refreshTrigger={refreshSessions}
                  className="h-full"
                  collapsed={false}
                  onFirstCaseDetected={() => setHasUnsavedNewChat(false)}
                  onAfterDelete={handleAfterDelete}
                  onCasesLoaded={(loadedCases) => {
                    // Remove optimistic cases that now exist as real cases
                    const loadedCaseIds = new Set(loadedCases.map(c => c.case_id));
                    setOptimisticCases(prev => {
                      const filtered = prev.filter(optimisticCase => {
                        const realId = idMappingManager.getRealId(optimisticCase.case_id);
                        if (realId && loadedCaseIds.has(realId)) {
                          console.log('[SidePanelApp] 🧹 Removing optimistic case - real case found in backend:', { optimistic: optimisticCase.case_id, real: realId });
                          return false; // Remove this optimistic case
                        }
                        return true; // Keep this optimistic case
                      });
                      return filtered;
                    });
                  }}
                  pendingCases={optimisticCases}
                  onCaseTitleChange={(caseId, newTitle) => {
                    console.log('[SidePanelApp] 🚀 User title change - using optimistic update:', { caseId, newTitle });
                    handleOptimisticTitleUpdate(caseId, newTitle);
                  }}
                  pinnedCases={pinnedCases}
                  onPinToggle={handlePinToggle}
                />
              </ErrorBoundary>
            </div>
            <div className="flex-shrink-0 p-4 border-t border-gray-200">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 py-2.5 px-4 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Logout"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm font-medium">Logout</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChatContent = () => {
    // Always render ChatWindow only when a case is active or we are in explicit new chat flow
    if (!activeCaseId && !hasUnsavedNewChat) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">Start a conversation</h2>
            <p className="text-sm text-gray-600 mb-4">Select a chat from the list or create a new one.</p>
            <button
              onClick={() => handleNewSession('')}
              className="inline-flex items-center gap-2 py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              New chat
            </button>
          </div>
        </div>
      );
    }

    // Check for failed operations that need user attention
    const failedOperations = getFailedOperationsForUser();

    return (
      <ErrorBoundary
        fallback={
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">Error loading chat</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Retry
            </button>
          </div>
        }
      >
        <div className="h-full flex flex-col">
          {/* Failed Operations Alert */}
          {failedOperations.length > 0 && (
            <div className="flex-shrink-0 p-4 space-y-3">
              {failedOperations.map((operation) => {
                const errorInfo = getErrorMessageForOperation(operation);
                return (
                  <div key={operation.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                          <h4 className="text-sm font-medium text-yellow-800">{errorInfo.title}</h4>
                        </div>
                        <p className="text-xs text-yellow-700 mt-1">{errorInfo.message}</p>
                        <p className="text-xs text-yellow-600 mt-2 italic">{errorInfo.recoveryHint}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <button
                          onClick={() => handleUserRetry(operation.id)}
                          className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 transition-colors font-medium"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => handleDismissFailedOperation(operation.id)}
                          className="p-1 text-yellow-600 hover:text-yellow-800 transition-colors"
                          title="Dismiss this error"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Main Chat Window */}
          <div className="flex-1 min-h-0">
            <ChatWindow
              conversation={conversations[activeCaseId || ''] || []}
              activeCase={activeCase}
              loading={loading}
              submitting={submitting}
              sessionId={sessionId}
              isNewUnsavedChat={hasUnsavedNewChat}
              investigationProgress={activeCaseId ? investigationProgress[activeCaseId] : null}
              onQuerySubmit={handleQuerySubmit}
              onDataUpload={handleDataUpload}
              onDocumentView={handleDocumentView}
              className="h-full"
            />
          </div>
        </div>
      </ErrorBoundary>
    );
  };

  const renderMainContent = () => {
    return (
      <div className="flex w-full h-full">
        {renderSidebar()}
        <div className="flex-1 flex flex-col min-w-0 max-w-none">
          <div className="flex-1 overflow-y-auto">
            <div className={`h-full ${activeTab === 'copilot' ? 'block' : 'hidden'}`}>
              {renderChatContent()}
            </div>
            <div className={`h-full ${activeTab === 'kb' ? 'block' : 'hidden'}`}>
              <ErrorBoundary
                fallback={
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">Error loading Knowledge Base</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Retry
                    </button>
                  </div>
                }
              >
                <KnowledgeBaseView className="h-full" />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50 text-gray-800 text-sm font-sans">
        {renderMainContent()}
      </div>

      {/* Error Handling UI */}
      <ToastContainer
        activeErrors={getErrorsByType('toast')}
        onDismiss={dismissError}
        onRetry={async (errorId) => {
          // Retry logic will be handled by error handler's retry action
          console.log('[SidePanelApp] Toast retry clicked:', errorId);
        }}
        position="top-right"
      />

      <ErrorModal
        activeError={getErrorsByType('modal')[0] || null}
        onAction={async (errorId) => {
          // Handle modal actions (e.g., redirect to login)
          console.log('[SidePanelApp] Modal action:', errorId);
          const modalError = getErrorsByType('modal').find(e => e.id === errorId);
          if (modalError?.error.category === 'authentication') {
            // Handle auth errors - could redirect to login
            await handleLogout();
          }
          dismissError(errorId);
        }}
      />

      {/* Other Modals */}
      <DocumentDetailsModal
        document={viewingDocument}
        isOpen={isDocumentModalOpen}
        onClose={() => {
          setIsDocumentModalOpen(false);
          setViewingDocument(null);
        }}
        onEdit={() => {
          setIsDocumentModalOpen(false);
          setViewingDocument(null);
        }}
      />
      <ConflictResolutionModal
        isOpen={conflictResolutionData.isOpen}
        conflict={conflictResolutionData.conflict!}
        localData={conflictResolutionData.localData}
        remoteData={conflictResolutionData.remoteData}
        mergeResult={conflictResolutionData.mergeResult}
        availableBackups={conflictResolutionData.conflict ? conflictResolver.getBackupsForCase(conflictResolutionData.conflict.affectedData.caseId || '') : []}
        onResolve={handleConflictResolution}
        onCancel={cancelConflictResolution}
      />
    </ErrorBoundary>
  );
}
