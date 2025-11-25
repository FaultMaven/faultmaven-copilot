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
  SourceMetadata,
  formatFileSize,
  formatDataType,
  formatCompression
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
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoadingScreen } from "./components/LoadingScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { capabilitiesManager, type BackendCapabilities } from "../../lib/capabilities";
import { ErrorState } from "./components/ErrorState";
import ConversationsList from "./components/ConversationsList";
import { ChatWindow } from "./components/ChatWindow";
import DocumentDetailsModal from "./components/DocumentDetailsModal";
import { ConflictResolutionModal, ConflictResolution } from "./components/ConflictResolutionModal";
import { ReportGenerationDialog } from "./components/ReportGenerationDialog";
import { PersistenceManager } from "../../lib/utils/persistence-manager";
import { memoryManager } from "../../lib/utils/memory-manager";
import { useAuth } from "./hooks/useAuth";
// Phase 1 Week 1: New layout components
import { CollapsibleNavigation, ContentArea } from "./layouts";

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
  const { isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<'copilot'>('copilot');
  const [hasCompletedFirstRun, setHasCompletedFirstRun] = useState<boolean | null>(null);
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  const [initializingCapabilities, setInitializingCapabilities] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
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

  // Phase 3 Week 7: Evidence tracking per case
  const [caseEvidence, setCaseEvidence] = useState<Record<string, UploadedData[]>>({});

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

  // Report generation dialog state (FR-CM-006)
  const [showReportDialog, setShowReportDialog] = useState(false);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Initialize capabilities and check first-run
  useEffect(() => {
    const initializeCapabilities = async () => {
      try {
        // 1. Check if first run
        const stored = await browser.storage.local.get(['hasCompletedFirstRun', 'apiEndpoint']);
        const completedFirstRun = stored.hasCompletedFirstRun || false;
        const apiEndpoint = stored.apiEndpoint || 'https://api.faultmaven.ai';

        setHasCompletedFirstRun(completedFirstRun);

        if (!completedFirstRun) {
          // Show welcome screen - don't fetch capabilities yet
          setInitializingCapabilities(false);
          return;
        }

        // 2. Fetch capabilities from backend
        console.log('[SidePanelApp] Fetching capabilities from:', apiEndpoint);
        const caps = await capabilitiesManager.fetch(apiEndpoint);
        setCapabilities(caps);
        setCapabilitiesError(null);
        console.log('[SidePanelApp] Capabilities loaded:', caps.deploymentMode);

      } catch (error) {
        console.error('[SidePanelApp] Failed to load capabilities:', error);
        setCapabilitiesError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setInitializingCapabilities(false);
      }
    };

    initializeCapabilities();
  }, [hasCompletedFirstRun]);

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
    // Open Dashboard login page
    // Determine URL based on capabilities or config
    const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL || capabilities?.dashboardUrl || 'http://localhost:5173';
    // Ensure URL ends without trailing slash for consistency
    const baseUrl = dashboardUrl.endsWith('/') ? dashboardUrl.slice(0, -1) : dashboardUrl;
    const loginUrl = `${baseUrl}/login?source=extension`;
    
    window.open(loginUrl, '_blank');
    // The auth-bridge content script will detect login and send message back
    // The useAuth hook or background listener will update state
  };

  /* Deprecated local dev login
  const handleLoginOld = async () => {
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
  */

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
        // v2.0: owner_id is required - use empty string as placeholder (will be populated from backend)
        const minimalCase: UserCase = {
          case_id: caseId,
          owner_id: '',  // v2.0: required field (will be populated when full case data loads)
          title: conversationTitles[caseId] || 'Loading...',
          status: 'consulting', // New cases start in consulting phase
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          message_count: 0
        };
        setActiveCase(minimalCase);
      }

      // ARCHITECTURAL FIX: Check for conversation data under both selected and resolved IDs
      // This prevents unnecessary API calls after ID reconciliation
      // BUG FIX: Check for non-empty arrays (empty array [] is truthy but means no data)
      const hasConversationData =
        (conversations[caseId] && conversations[caseId].length > 0) ||
        (conversations[resolvedCaseId] && conversations[resolvedCaseId].length > 0);

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
          // Backend: { message_id, turn_number, role: 'user'|'agent', content, created_at }
          // Frontend: { id, turn_number, question?, response?, timestamp }
          const transformed: OptimisticConversationItem = {
            id: msg.message_id,
            timestamp: msg.created_at,
            turn_number: msg.turn_number, // Backend now provides turn_number
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

      // Create real case via API (v2.0: owner_id auto-populated from session)
      console.log('[SidePanelApp] 📡 Creating real case via API (v2.0)...', { title });
      const realCase = await createCase({
        title: title,
        priority: 'medium',
        metadata: {
          created_via: 'browser_extension',
          optimistic_id: optimisticCaseId
        }
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

      // TITLE PROTECTION RULES:
      // 1. User titles are NEVER overwritten by backend or system
      // 2. System titles (timestamps) can be overwritten by backend (old auto-rename flow)
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

    console.log('[SidePanelApp] 🚀 MESSAGE SUBMISSION START (session-based lazy case creation)');

    // LOCK INPUT: Prevent multiple submissions (immediate feedback)
    setSubmitting(true);

    // SESSION-BASED CASE CREATION + OPTIMISTIC MESSAGE UI: Immediate UI updates (0ms response)

    // Generate optimistic message IDs
    const userMessageId = OptimisticIdGenerator.generateMessageId();
    const aiMessageId = OptimisticIdGenerator.generateMessageId();
    const messageTimestamp = new Date().toISOString(); // ISO 8601 format to match backend

    // Step 1: Ensure case exists using session-based lazy creation
    let targetCaseId = activeCaseId;

    if (!targetCaseId) {
      console.log('[SidePanelApp] No active case, creating case via /api/v1/cases (v2.0)');

      try {
        // Backend auto-generates title in format: Case-MMDD-N
        // No need to fetch existing cases or generate title on frontend
        const caseData = await createCase({
          title: undefined,  // Let backend auto-generate
          priority: 'medium',
          metadata: {
            created_via: 'browser_extension',
            auto_generated: true
          }
        });

        const newCaseId = caseData.case_id;

        if (!newCaseId) {
          throw new Error('Backend response missing case_id');
        }

        targetCaseId = newCaseId;

        // Update UI with real case ID and initialize case in sidebar
        setActiveCaseId(newCaseId);
        setHasUnsavedNewChat(false);

        // Set activeCase to enable input (critical for canInteract check in ChatWindow)
        // v2.0: owner_id is now required, session_id removed

        // Validate critical fields from backend
        if (!caseData.status) {
          console.error('[SidePanelApp] ⚠️ Backend did not provide status for new case:', caseData);
          showError('Backend error: Case created without status. Please contact support.');
          setSubmitting(false);
          return;
        }

        console.log('[SidePanelApp] 📊 Backend case data:', {
          status: caseData.status,
          title: caseData.title,
          created_at: caseData.created_at,
          updated_at: caseData.updated_at
        });

        setActiveCase({
          case_id: newCaseId,
          owner_id: caseData.owner_id,  // v2.0: required field
          title: caseData.title || 'Untitled Case',  // Backend auto-generates Case-MMDD-N format
          status: caseData.status,  // Required - no fallback to expose backend issues
          created_at: caseData.created_at || new Date().toISOString(),
          updated_at: caseData.updated_at || new Date().toISOString(),
          message_count: 0
        });

        // Initialize conversation for this case (empty initially)
        setConversations(prev => ({
          ...prev,
          [newCaseId]: []
        }));

        // Set title from backend response (will be auto-generated by backend)
        // Note: Frontend doesn't control case title - backend generates it
        if (caseData.title) {
          setConversationTitles(prev => ({
            ...prev,
            [newCaseId]: caseData.title
          }));
          setTitleSources(prev => ({
            ...prev,
            [newCaseId]: 'backend'
          }));
        }

        // Store in localStorage for persistence (frontend state management v2.0)
        await browser.storage.local.set({ faultmaven_current_case: targetCaseId });

        // Trigger ConversationsList refresh to load new case from backend
        setRefreshSessions(prev => prev + 1);

        console.log('[SidePanelApp] ✅ Case created via v2.0 API:', targetCaseId);
      } catch (error) {
        console.error('[SidePanelApp] Failed to create case:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to create case. Please try again.';
        showError(errorMessage);
        setSubmitting(false);
        return;
      }
    }

    // Safety check
    if (!targetCaseId) {
      console.error('[SidePanelApp] CRITICAL: No case ID available');
      showError('No active case. Please try again.');
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

    // Focus/highlight the active case in the sidebar (important for existing cases)
    setActiveCaseId(targetCaseId);

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

      // Submit query to case via API (backend will auto-create case if needed)
      console.log('[SidePanelApp] 📡 Submitting query to case via API...', { caseId, sessionId: currentSessionId });

      const queryRequest: QueryRequest = {
        session_id: currentSessionId,
        query: query.trim(),
        priority: 'low',
        context: {}
      };

      const response = await submitQueryToCase(caseId, queryRequest);

      // No ID reconciliation needed - caseId is already the real UUID from session endpoint
      console.log('[SidePanelApp] ✅ Query submitted successfully, response type:', response.response_type);

      // Update investigation progress from view_state (OODA Framework v3.2.0)
      if (response.view_state && response.view_state.investigation_progress) {
        setInvestigationProgress(prev => ({
          ...prev,
          [caseId]: response.view_state!.investigation_progress
        }));
        console.log('[SidePanelApp] 🔍 Investigation progress updated:', response.view_state.investigation_progress);
      }

      // Phase 3 Week 7: Update evidence from view_state
      if (response.view_state && response.view_state.uploaded_data) {
        setCaseEvidence(prev => ({
          ...prev,
          [caseId]: response.view_state!.uploaded_data
        }));
        console.log('[SidePanelApp] 📎 Evidence updated:', response.view_state.uploaded_data.length, 'items');
      }

      // Update active case with real data from view_state
      if (response.view_state && response.view_state.active_case) {
        const backendCase = response.view_state.active_case;

        console.log('[SidePanelApp] 📊 Backend view_state.active_case:', {
          status: backendCase.status,
          title: backendCase.title,
          created_at: backendCase.created_at,
          updated_at: backendCase.updated_at
        });

        setActiveCase(backendCase);

        // Update conversation title if backend provides one
        if (backendCase.title) {
          setConversationTitles(prev => ({
            ...prev,
            [caseId]: backendCase.title
          }));
        }

        console.log('[SidePanelApp] 📋 Case updated:', backendCase.title);
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

        // No ID reconciliation needed - using real case ID from session endpoint
        return {
          ...prev,
          [caseId]: updated
        };
      });

      // Update case title if backend provides one (but respect local titles)
      if (response.metadata?.case_title) {
        handleTitleGenerated(caseId, response.metadata.case_title, 'backend');
      }

      // Mark operation as completed
      pendingOpsManager.complete(aiMessageId);

      console.log('[SidePanelApp] ✅ Message submission completed and UI updated');

      // REMOVED OLD REDUNDANT RECONCILIATION BLOCK
      // ID reconciliation is now done immediately after response (lines 1418-1466)
      // This eliminates polling/waiting for ID mappings and complex conflict detection
      // Note: Optimistic case cleanup is handled by the onCasesLoaded callback
      // This ensures cleanup only happens AFTER the real case appears in backend response
      // to prevent timing gaps where no cases are visible in ConversationsList

    } catch (error) {
      console.error('[SidePanelApp] ❌ Background query submission failed:', error);

      // CRITICAL: Detect stale case ID (404 - case no longer exists in backend)
      // This happens after server restart or database reset
      const errorMessage = error instanceof Error ? error.message : '';
      const isStaleCase = errorMessage.includes('Case not found') ||
                          errorMessage.includes('404') ||
                          errorMessage.includes('access denied');

      if (isStaleCase) {
        console.warn('[SidePanelApp] ⚠️ Detected stale case ID - case no longer exists in backend:', caseId);
        console.log('[SidePanelApp] 🔄 Clearing stale case from cache to allow new case creation');

        // Clear stale case from localStorage (yield to server as source of truth)
        await browser.storage.local.remove(['faultmaven_current_case']);

        // Clear from active state
        setActiveCaseId(undefined);

        // Remove stale conversation data
        setConversations(prev => {
          const updated = { ...prev };
          delete updated[caseId];
          return updated;
        });

        // Show helpful error message
        showError('Your previous case no longer exists (server was restarted). Please click "New Chat" to start fresh.');

        // Mark operation as failed but don't show in conversation
        pendingOpsManager.remove(aiMessageId);
        return;
      }

      // For other errors, mark operation as failed
      pendingOpsManager.fail(aiMessageId, errorMessage);

      // Update AI message to show error state
      setConversations(prev => {
        const currentConversation = prev[caseId] || [];
        const updated = currentConversation.map(item => {
          if (item.id === aiMessageId) {
            return {
              ...item,
              response: `❌ Error: ${errorMessage || 'Unknown error occurred'}. Please try again.`,
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
      console.log('[SidePanelApp] 🔓 Input unlocked - response received');
    }
  };

  // Helper: Generate timestamp for filenames (e.g., "20251018-030542")
  const generateTimestamp = (): string => {
    const now = new Date();
    return now.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .substring(0, 15); // YYYYMMDD-HHMMSS
  };

  // Helper: Extract short URL identifier from full URL
  const extractShortUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      // Get hostname without www prefix
      const hostname = urlObj.hostname.replace(/^www\./, '');
      // Take first 20 chars to keep filename reasonable
      return hostname.substring(0, 20).replace(/\./g, '-');
    } catch (error) {
      // If URL parsing fails, return generic identifier
      return 'webpage';
    }
  };

  const handleDataUpload = async (
    data: string | File,
    dataSource: "text" | "file" | "page"
  ): Promise<{ success: boolean; message: string }> => {
    try {
      setLoading(true);

      if (!sessionId) {
        return {
          success: false,
          message: "Please log in first"
        };
      }

      // Step 1: Ensure case exists using session-based lazy creation
      // If no active case, call backend to get/create case for this session
      let targetCaseId = activeCaseId;

      if (!targetCaseId) {
        console.log('[SidePanelApp] No active case, creating case via /api/v1/cases (v2.0)');

        try {
          // Create case using v2.0 API (owner_id auto-populated from session)
          const caseTitle = IdUtils.generateChatTitle();

          const caseData = await createCase({
            title: caseTitle,
            priority: 'medium',
            metadata: {
              created_via: 'browser_extension',
              auto_generated: true
            }
          });

          const newCaseId = caseData.case_id;

          if (!newCaseId) {
            throw new Error('Backend response missing case_id');
          }

          targetCaseId = newCaseId;

          // Update UI with real case ID and initialize case in sidebar
          setActiveCaseId(newCaseId);
          setHasUnsavedNewChat(false);

          // Set activeCase to enable input (critical for canInteract check in ChatWindow)
          // v2.0: owner_id is now required, session_id removed
          setActiveCase({
            case_id: newCaseId,
            owner_id: caseData.owner_id,  // v2.0: required field
            title: caseData.title || caseTitle,
            status: caseData.status || 'consulting', // Use actual backend status
            created_at: caseData.created_at || new Date().toISOString(),
            updated_at: caseData.updated_at || new Date().toISOString(),
            message_count: 0
          });

          // Initialize conversation for this case (empty initially)
          setConversations(prev => ({
            ...prev,
            [newCaseId]: []
          }));

          // Set title from backend response (will be auto-generated by backend)
          // Note: Frontend doesn't control case title - backend generates it
          if (caseData.title) {
            setConversationTitles(prev => ({
              ...prev,
              [newCaseId]: caseData.title
            }));
            setTitleSources(prev => ({
              ...prev,
              [newCaseId]: 'backend'
            }));
          }

          // Store in localStorage for persistence (frontend state management v2.0)
          await browser.storage.local.set({ faultmaven_current_case: targetCaseId });

          // Trigger ConversationsList refresh to load new case from backend
          setRefreshSessions(prev => prev + 1);

          console.log('[SidePanelApp] ✅ Case created via v2.0 API:', targetCaseId);
        } catch (error) {
          console.error('[SidePanelApp] Failed to create case:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to create case. Please try again.';
          return {
            success: false,
            message: errorMessage
          };
        }
      }

      // Safety check: Ensure we have a case ID at this point
      if (!targetCaseId) {
        console.error('[SidePanelApp] CRITICAL: No case ID available');
        return {
          success: false,
          message: 'No active case. Please try again.'
        };
      }

      // Capture page URL FIRST (needed for filename generation)
      let capturedUrl: string | undefined;
      if (dataSource === 'page') {
        try {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.url) {
            capturedUrl = tab.url;
          }
        } catch (err) {
          console.warn('[SidePanelApp] Could not capture page URL:', err);
        }
      }

      // Convert text/page data to File if needed
      let fileToUpload: File;
      if (data instanceof File) {
        // File upload: keep original filename (no change)
        fileToUpload = data;
      } else {
        // Text paste or page capture: generate improved filename
        const blob = new Blob([data], { type: 'text/plain' });
        const timestamp = generateTimestamp();

        let filename: string;
        if (dataSource === 'page') {
          // Web page: page-content-<short-url>.html
          const shortUrl = capturedUrl ? extractShortUrl(capturedUrl) : 'webpage';
          filename = `page-content-${shortUrl}.html`;
        } else {
          // Text paste: text-data-<timestamp>.txt
          filename = `text-data-${timestamp}.txt`;
        }

        fileToUpload = new File([blob], filename, { type: 'text/plain' });
        console.log(`[SidePanelApp] Generated filename for ${dataSource}:`, filename);
      }

      console.log('[SidePanelApp] Uploading file:', fileToUpload.name);

      // Create source metadata based on data source
      const sourceMetadata: SourceMetadata = {
        source_type: dataSource === 'file' ? 'file_upload'
                   : dataSource === 'page' ? 'page_capture'
                   : 'text_paste'
      };

      // Add captured URL to metadata
      if (capturedUrl) {
        sourceMetadata.source_url = capturedUrl;
        sourceMetadata.captured_at = new Date().toISOString();
      }

      // Step 2: Upload data to the case (now that we have a real case ID)
      let uploadResponse;
      try {
        uploadResponse = await uploadDataToCase(
          targetCaseId,
          sessionId,
          fileToUpload,
          sourceMetadata
        );
      } catch (error) {
        // If case not found (404), the case may have been deleted - create a new one
        if (error instanceof Error && error.message.includes('Case not found')) {
          console.warn('[SidePanelApp] Case not found, creating new case and retrying upload');

          // Create a new case
          const caseTitle = IdUtils.generateChatTitle();
          const caseData = await createCase({
            title: caseTitle,
            priority: 'medium',
            metadata: {
              created_via: 'browser_extension',
              auto_generated: true,
              recovery_reason: 'case_not_found_404'
            }
          });

          const newCaseId = caseData.case_id;
          if (!newCaseId) {
            throw new Error('Backend response missing case_id during recovery');
          }

          // Update UI with the new case
          targetCaseId = newCaseId;
          setActiveCaseId(newCaseId);
          setActiveCase({
            case_id: newCaseId,
            owner_id: caseData.owner_id,
            title: caseData.title || caseTitle,
            status: caseData.status || 'consulting', // Use actual backend status
            created_at: caseData.created_at || new Date().toISOString(),
            updated_at: caseData.updated_at || new Date().toISOString(),
            message_count: 0
          });

          // Retry upload with new case ID
          uploadResponse = await uploadDataToCase(
            targetCaseId,
            sessionId,
            fileToUpload,
            sourceMetadata
          );

          console.log('[SidePanelApp] Successfully recovered from 404 with new case:', newCaseId);
        } else {
          // Re-throw other errors
          throw error;
        }
      }

      // No ID reconciliation needed - targetCaseId is already the real UUID from backend
      console.log('[SidePanelApp] ✅ Data uploaded successfully to case:', targetCaseId);
      console.log('[SidePanelApp] Backend returned filename:', uploadResponse.file_name);
      console.log('[SidePanelApp] Frontend sent filename:', fileToUpload.name);

      // Generate user upload message with data type badge
      const dataTypeBadge = uploadResponse.data_type
        ? ` [${uploadResponse.data_type}]`
        : '';
      const compressionInfo = uploadResponse.classification?.compression_ratio
        ? ` (${uploadResponse.classification.compression_ratio.toFixed(1)}x compressed)`
        : '';

      const userMessage: OptimisticConversationItem = {
        id: `upload-${Date.now()}`,
        question: `📎 Uploaded: ${uploadResponse.file_name || fileToUpload.name} (${formatFileSize(uploadResponse.file_size || 0)})${dataTypeBadge}${compressionInfo}`,
        timestamp: uploadResponse.uploaded_at || new Date().toISOString(),
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
        // v3.2.0 OODA framework fields
        suggestedActions: uploadResponse.agent_response?.suggested_actions,
        optimistic: false
      };

      // Update conversation with both messages
      setConversations(prev => ({
        ...prev,
        [targetCaseId]: [...(prev[targetCaseId] || []), userMessage, aiMessage]
      }));

      // Phase 3 Week 7: Add uploaded data to evidence list
      setCaseEvidence(prev => ({
        ...prev,
        [targetCaseId]: [...(prev[targetCaseId] || []), uploadResponse]
      }));

      // Focus/highlight the active case in the sidebar (important for existing cases)
      setActiveCaseId(targetCaseId);

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

      // Enhanced error handling for v3.1.0
      let errorMessage = "Upload failed";
      let errorDetails = error instanceof Error ? error.message : "Unknown error occurred";

      // Parse backend error responses
      if (error && typeof error === 'object' && 'response' in error) {
        const responseError = error as any;
        if (responseError.response?.data?.detail) {
          errorDetails = responseError.response.data.detail;
        }
      }

      // Handle specific error cases
      if (errorDetails.includes("Authentication required") || errorDetails.includes("Unauthorized") || errorDetails.includes("401")) {
        errorMessage = "Authentication required";
        errorDetails = "Please sign in again";
        // Clear authentication state and redirect to login
        setIsAuthenticated(false);
        setSessionId(null);
      } else if (errorDetails.includes("File too large")) {
        errorMessage = "File too large";
        errorDetails = "Maximum file size is 50MB";
      } else if (errorDetails.includes("Unable to decode") || errorDetails.includes("decode")) {
        errorMessage = "Invalid file format";
        errorDetails = "Please upload text-based files only";
      } else if (errorDetails.includes("Case not found")) {
        errorMessage = "Case not found";
        errorDetails = "Please refresh and try again";
      } else if (errorDetails.includes("session")) {
        errorMessage = "Session error";
        errorDetails = "Please refresh the page and try again";
      }

      return {
        success: false,
        message: `${errorMessage}: ${errorDetails}`
      };
    } finally {
      console.log('[SidePanelApp] 🔓 Unlocking loading state after upload (finally block)');
      setLoading(false);
    }
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  // Phase 1 Week 1: Handler for tab changes from navigation (chat-only now)
  const handleTabChange = (tab: 'copilot') => {
    setActiveTab(tab);
  };

  // Phase 1 Week 1: Handler for new chat from navigation
  const handleNewChatFromNav = () => {
    setActiveTab('copilot');
    handleNewSession('');
  };

  // Handle document viewing from sources
  const handleDocumentView = async (documentId: string) => {
    try {
      const document = await getKnowledgeDocument(documentId);
      setViewingDocument(document);
      setIsDocumentModalOpen(true);
    } catch {
      // noop
    }
  };

  // Open dashboard for KB management
  const handleOpenDashboard = () => {
    const dashboardUrl = capabilities?.dashboardUrl;
    if (dashboardUrl) {
      window.open(dashboardUrl, '_blank');
    } else {
      showError('Dashboard URL not available');
    }
  };


  // Login screen
  const renderLogin = () => (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white border border-gray-200 rounded-lg p-6 w-full max-w-sm shadow-sm">
        <div className="text-center mb-4">
          <img src="/icon/square-light.svg" alt="FaultMaven" className="w-12 h-12 mx-auto mb-2" />
          <h2 className="text-base font-semibold text-gray-800">Welcome to FaultMaven</h2>
          <p className="text-xs text-gray-500">Sign in to FaultMaven Dashboard to continue</p>
        </div>
        
        {authError && (
          <div className="text-xs text-red-600 mb-4 text-center">{authError}</div>
        )}
        
        <div className="mt-4">
          <button
            onClick={handleLogin}
            className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <span>Sign In to Dashboard</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  // Show welcome screen on first run
  if (hasCompletedFirstRun === false) {
    return (
      <ErrorBoundary>
        <WelcomeScreen
          onComplete={async () => {
            setHasCompletedFirstRun(true);
            // Capabilities will be fetched by useEffect when hasCompletedFirstRun becomes true
          }}
        />
      </ErrorBoundary>
    );
  }

  // Show loading while initializing capabilities
  if (initializingCapabilities) {
    return (
      <ErrorBoundary>
        <LoadingScreen message="Connecting to FaultMaven..." />
      </ErrorBoundary>
    );
  }

  // Show error if capabilities fetch failed
  if (capabilitiesError) {
    return (
      <ErrorBoundary>
        <ErrorScreen
          message={`Failed to connect to backend: ${capabilitiesError}`}
          action={{
            label: "Open Settings",
            onClick: () => browser.runtime.openOptionsPage()
          }}
        />
      </ErrorBoundary>
    );
  }

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

  // Phase 1 Week 1: Replaced renderSidebar(), renderChatContent(), and renderMainContent()
  // with new CollapsibleNavigation and ContentArea components

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50 text-gray-800 text-sm font-sans">
        {/* Phase 1 Week 1: New component-based layout */}
        <CollapsibleNavigation
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          activeTab={activeTab}
          activeCaseId={activeCaseId}
          sessionId={sessionId || undefined}
          hasUnsavedNewChat={hasUnsavedNewChat}
          isAdmin={isAdmin()}
          conversationTitles={conversationTitles}
          optimisticCases={optimisticCases}
          pinnedCases={pinnedCases}
          refreshTrigger={refreshSessions}
          dashboardUrl={capabilities?.dashboardUrl}
          onTabChange={handleTabChange}
          onOpenDashboard={handleOpenDashboard}
          onCaseSelect={handleCaseSelect}
          onNewChat={handleNewChatFromNav}
          onLogout={handleLogout}
          onCaseTitleChange={handleOptimisticTitleUpdate}
          onPinToggle={handlePinToggle}
          onAfterDelete={handleAfterDelete}
          onCasesLoaded={(loadedCases) => {
            // Remove optimistic cases that now exist as real cases
            const loadedCaseIds = new Set(loadedCases.map(c => c.case_id));
            setOptimisticCases(prev => {
              const filtered = prev.filter(optimisticCase => {
                const realId = idMappingManager.getRealId(optimisticCase.case_id);
                if (realId && loadedCaseIds.has(realId)) {
                  console.log('[SidePanelApp] 🧹 Removing optimistic case - real case found in backend:', { optimistic: optimisticCase.case_id, real: realId });
                  return false;
                }
                return true;
              });
              return filtered;
            });
          }}
        />

        <ContentArea
          activeTab={activeTab}
          activeCaseId={activeCaseId}
          activeCase={activeCase}
          conversations={conversations}
          loading={loading}
          submitting={submitting}
          sessionId={sessionId}
          hasUnsavedNewChat={hasUnsavedNewChat}
          investigationProgress={investigationProgress}
          caseEvidence={caseEvidence}
          failedOperations={getFailedOperationsForUser()}
          onQuerySubmit={handleQuerySubmit}
          onDataUpload={handleDataUpload}
          onDocumentView={handleDocumentView}
          onGenerateReports={() => setShowReportDialog(true)}
          onNewChat={handleNewChatFromNav}
          onRetryFailedOperation={handleUserRetry}
          onDismissFailedOperation={handleDismissFailedOperation}
          getErrorMessageForOperation={getErrorMessageForOperation}
        />
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

      {/* Report Generation Dialog (FR-CM-006) */}
      {showReportDialog && activeCaseId && (
        <ReportGenerationDialog
          caseId={activeCaseId}
          caseTitle={activeCase?.title || 'Untitled Case'}
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          onReportsGenerated={(reports) => {
            console.log('[SidePanelApp] Reports generated:', reports);
            // Optionally update case status or show notification
            setShowReportDialog(false);
          }}
        />
      )}
    </ErrorBoundary>
  );
}
