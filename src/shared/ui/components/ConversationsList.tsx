import React, { useState, useEffect } from 'react';
import { UserCase, getUserCases, deleteCase as deleteCaseApi, generateCaseTitle, updateCaseTitle as apiUpdateCaseTitle } from '../../../lib/api';
import { ConversationItem } from './ConversationItem';
import LoadingSpinner from './LoadingSpinner';
import {
  mergeOptimisticAndReal,
  sanitizeBackendCases,
  sanitizeOptimisticCases,
  validateStateIntegrity,
  debugDataSeparation,
  isOptimisticId,
  type ValidatedCase,
  type RealCase,
  type OptimisticCase
} from '../../../lib/utils/data-integrity';
import { idMappingManager } from '../../../lib/optimistic';

interface ConversationsListProps {
  activeSessionId?: string; // kept for compatibility
  activeCaseId?: string;
  onCaseSelect?: (caseId: string) => void;
  onSessionSelect?: (sessionId: string) => void; // kept for compatibility
  onNewSession: (sessionId: string) => void;
  conversationTitles?: Record<string, string>;
  hasUnsavedNewChat?: boolean;
  refreshTrigger?: number;
  className?: string;
  collapsed?: boolean;
  onFirstCaseDetected?: () => void;
  onAfterDelete?: (deletedCaseId: string, remaining: Array<{ case_id: string; updated_at?: string; created_at?: string }>) => void;
  onCasesLoaded?: (cases: UserCase[]) => void;
  pendingCases?: UserCase[];
  onCaseTitleChange?: (caseId: string, newTitle: string) => void;
  pinnedCases?: Set<string>;
  onPinToggle?: (caseId: string) => void;
}

export function ConversationsList({
  activeSessionId,
  activeCaseId,
  onCaseSelect,
  onSessionSelect,
  onNewSession,
  conversationTitles = {},
  hasUnsavedNewChat = false,
  refreshTrigger = 0,
  className = '',
  collapsed = false,
  onFirstCaseDetected,
  onAfterDelete,
  onCasesLoaded,
  pendingCases = [],
  onCaseTitleChange,
  pinnedCases = new Set(),
  onPinToggle
}: ConversationsListProps) {
  const [cases, setCases] = useState<RealCase[]>([]); // STRICT: Only real cases from backend
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caseTitles, setCaseTitles] = useState<Record<string, string>>({});
  const [titleGenStatus, setTitleGenStatus] = useState<{ message: string; type: 'success' | 'info' | 'error' | '' }>({ message: "", type: "" });

  useEffect(() => { loadCases(); }, []);
  useEffect(() => { if (refreshTrigger > 0) loadCases(); }, [refreshTrigger]);

  // Sync parent conversationTitles changes to local caseTitles state
  useEffect(() => {
    if (conversationTitles && Object.keys(conversationTitles).length > 0) {
      console.log('[ConversationsList] Syncing conversationTitles to local caseTitles:', conversationTitles);
      setCaseTitles(prev => ({
        ...prev,
        ...conversationTitles // Merge parent titles into local state
      }));
    }
  }, [conversationTitles]);
  

  // Auto-clear title generation status after 4 seconds
  useEffect(() => {
    if (titleGenStatus.message) {
      const timer = setTimeout(() => {
        setTitleGenStatus({ message: "", type: "" });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [titleGenStatus.message]);
  // ARCHITECTURAL FIX: Use strict data separation utilities
  const mergeWithPending = (baseCases: RealCase[]): ValidatedCase[] => {
    // DEFENSE: Use defensive merging with violation detection
    const mergeResult = mergeOptimisticAndReal(
      baseCases,
      pendingCases || [],
      'ConversationsList'
    );

    // Log merge statistics (commented out to reduce console noise)
    // console.log('[ConversationsList] STRICT MERGE result:', {
    //   totalCases: mergeResult.cases.length,
    //   realCases: mergeResult.realCount,
    //   optimisticCases: mergeResult.optimisticCount,
    //   violations: mergeResult.violations.length,
    //   caseIds: mergeResult.cases.map(c => `${c.case_id} (${c.source})`)
    // });

    // Report violations
    if (mergeResult.violations.length > 0) {
      console.error('[ConversationsList] Data integrity violations:', mergeResult.violations);
    }

    return mergeResult.cases;
  };

  const loadCases = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await getUserCases({ limit: 100, offset: 0 });

      console.log('[ConversationsList] 🔍 RAW API RESPONSE from getUserCases:', JSON.stringify(list, null, 2));

      // DEFENSIVE: Strictly sanitize backend data
      const sanitizedRealCases = sanitizeBackendCases(list || [], 'loadCases');

      console.log('[ConversationsList] ✅ SANITIZED backend cases:', {
        received: list?.length || 0,
        sanitized: sanitizedRealCases.length,
        caseIds: sanitizedRealCases.map(c => c.case_id)
      });

      const sorted = mergeWithPending(sanitizedRealCases);
      setCases(sanitizedRealCases); // Store only real cases in state
      console.log('[ConversationsList] Backend cases stored in state:', sanitizedRealCases.map(c => c.case_id));

      // ARCHITECTURAL FIX: Notify parent with ONLY real backend cases (no optimistic contamination)
      onCasesLoaded?.(sanitizedRealCases);
    } catch (err) {
      const full = err instanceof Error ? err.message : String(err);
      console.error('[ConversationsList] Failed to load cases:', full);
      setError(`Failed to list chats: ${full}`);
      setCases([]);

      // Still notify parent even on error (with empty array)
      onCasesLoaded?.([]);
    } finally {
      setLoading(false);
    }
  };

  const getCaseTitle = (c: UserCase): string => {
    const t = caseTitles[c.case_id] || (conversationTitles && conversationTitles[c.case_id]) || c.title;
    if (t && t.trim()) return t;

    // Use same readable format as handleCaseActivated
    const timestamp = new Date(c.updated_at || c.created_at || Date.now()).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `Chat-${timestamp}`;
  };

  const updateCaseTitle = (caseId: string, title: string) => {
    console.log('[ConversationsList] updateCaseTitle called:', { caseId, title });
    console.log('[ConversationsList] Current caseTitles before update:', caseTitles);
    setCaseTitles(prev => {
      const updated = { ...prev, [caseId]: title };
      console.log('[ConversationsList] Updated caseTitles:', updated);
      return updated;
    });
  };

  const handleRenameCase = async (caseId: string, newTitle: string) => {
    const title = (newTitle || '').trim();
    if (!title) return;
    console.log('[ConversationsList] handleRenameCase called:', { caseId, title });

    // OPTIMISTIC UPDATE: Update local state immediately
    console.log('[ConversationsList] Updating local caseTitles...');
    updateCaseTitle(caseId, title);

    // Notify parent component - parent handles backend sync
    console.log('[ConversationsList] Notifying parent component (parent will handle backend sync)...');
    onCaseTitleChange?.(caseId, title);

    // NOTE: Backend sync is now handled by parent (SidePanelApp.handleOptimisticTitleUpdate)
    // This prevents duplicate API calls (previously we called API here AND parent called it)
  };

  const handleGenerateTitle = async (caseId: string, sessionIdGuess?: string) => {
    console.log('[ConversationsList] handleGenerateTitle called for case:', caseId);

    try {
      // ARCHITECTURAL FIX: Resolve optimistic IDs to real IDs for API calls
      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;

      console.log('[ConversationsList] Calling generateCaseTitle API...', {
        selectedId: caseId,
        resolvedId: resolvedCaseId,
        isOptimistic: isOptimisticId(caseId)
      });

      const { title, source } = await generateCaseTitle(resolvedCaseId, { max_words: 8 });
      console.log('[ConversationsList] API response - title:', title, 'source:', source);

      const newTitle = (title || '').trim();
      if (!newTitle) {
        console.log('[ConversationsList] Empty title returned - insufficient context');
        setTitleGenStatus({ message: "More conversation needed for a meaningful title", type: "info" });
        return;
      }

      console.log('[ConversationsList] Applying new title:', newTitle);
      // Update local state only - backend already persisted the title
      updateCaseTitle(caseId, newTitle);
      // Note: No need to call onCaseTitleChange() since backend already persisted the title

      // Show different messages based on whether title was newly generated or already existed
      if (source === 'existing') {
        setTitleGenStatus({ message: "Title set previously", type: "info" });
      } else {
        setTitleGenStatus({ message: "Title generated successfully", type: "success" });
      }
    } catch (e: any) {
      console.error('[ConversationsList] Title generation error:', e);
      const msg = (e?.message || '').toString().toLowerCase();
      if (msg.includes('insufficient context')) {
        console.info('[ConversationsList] Title generation skipped: insufficient context');
        setTitleGenStatus({ message: "More conversation needed for a meaningful title", type: "info" });
        return;
      }
      console.warn('[ConversationsList] Title generation failed:', e);
      setTitleGenStatus({ message: "Title generation failed", type: "error" });
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    try {
      await deleteCaseApi(caseId);
      setCases(prev => {
        const remaining = prev.filter(c => c.case_id !== caseId);
        // Notify parent first
        try { onAfterDelete && onAfterDelete(caseId, remaining); } catch {}
        // If we deleted the active case, auto-switch to most recent remaining; else start new
        try {
          if (activeCaseId && activeCaseId === caseId) {
            const sorted = [...remaining].sort((a,b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
            const next = sorted[0];
            if (next && next.case_id) {
              onCaseSelect && onCaseSelect(next.case_id);
            } else {
              onNewSession && onNewSession('');
            }
          }
        } catch {}
        return remaining;
      });
      // Refresh from server to ensure list reflects backend state
      try { await loadCases(); } catch {}
    } catch (e) {
      console.error('[ConversationsList] Delete failed:', e);
    }
  };

  const groupCasesByTime = (items: UserCase[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const groups = {
      pinned: [] as UserCase[],
      today: [] as UserCase[],
      sevenDays: [] as UserCase[],
      thirtyDays: [] as UserCase[],
      older: [] as UserCase[]
    };

    items.filter(c => c && c.case_id).forEach(c => {
      // Pinned cases go to their own group
      if (pinnedCases.has(c.case_id)) {
        groups.pinned.push(c);
        return;
      }

      const d = new Date(c.updated_at || c.created_at || 0);
      if (d >= today) groups.today.push(c);
      else if (d >= sevenDaysAgo) groups.sevenDays.push(c);
      else if (d >= thirtyDaysAgo) groups.thirtyDays.push(c);
      else groups.older.push(c);
    });
    return groups;
  };

  // ARCHITECTURAL FIX: Only show "(pending)" for truly pending cases, not reconciled ones
  // Filter out optimistic cases that have been successfully reconciled to real IDs
  const pendingIdSet = new Set<string>(
    (pendingCases || [])
      .filter(pc => {
        // If this is an optimistic case, check if it has been reconciled
        if (isOptimisticId(pc.case_id)) {
          // If there's a real ID mapping, this case is no longer truly "pending"
          return !idMappingManager.getRealId(pc.case_id);
        }
        // Real cases can't be pending by definition
        return false;
      })
      .map(pc => pc.case_id)
  );

  const handlePinToggle = (caseId: string) => {
    onPinToggle?.(caseId);
  };

  const renderCaseGroup = (title: string, items: UserCase[]) => {
    if (items.length === 0) return null;
    return (
      <div key={title} className="space-y-1">
        <h3 className="text-xs font-medium text-gray-500 px-3 py-2 uppercase tracking-wider">{title}</h3>
        <div className="space-y-1">
          {items.map((c) => (
            <ConversationItem
              key={c.case_id}
              session={{ session_id: c.case_id, created_at: c.created_at || '', status: 'active', last_activity: c.updated_at || '', metadata: {} } as any}
              title={pendingIdSet.has(c.case_id) ? `${getCaseTitle(c)} (pending)` : getCaseTitle(c)}
              isActive={Boolean(activeCaseId && c.case_id === activeCaseId)}
              isUnsavedNew={false}
              isPinned={pinnedCases.has(c.case_id)}
              isPending={pendingIdSet.has(c.case_id)}
              onSelect={(id) => onCaseSelect && onCaseSelect(id)}
              onDelete={(id) => handleDeleteCase(id)}
              onRename={(id, t) => handleRenameCase(id, t)}
              onGenerateTitle={(id) => handleGenerateTitle(id, (c as any).session_id || activeSessionId)}
              onPin={onPinToggle ? () => handlePinToggle(c.case_id) : undefined}
            />
          ))}
        </div>
      </div>
    );
  };

  const mergedCases = mergeWithPending(cases);

  // VALIDATION: Check state integrity
  const currentState = {
    conversations: undefined, // We don't have access to this here, but could be passed down
    conversationTitles,
    optimisticCases: pendingCases
  };
  validateStateIntegrity(currentState, 'ConversationsList');

  // DEBUG: Enhanced logging with data separation info
  // Debug logging removed to prevent console spam - enable only when debugging
  // console.log('[ConversationsList] 🔍 COMPONENT STATE:', {
  //   realCasesInState: cases.length,
  //   optimisticCasesInProps: pendingCases?.length || 0,
  //   mergedCasesTotal: mergedCases.length,
  //   refreshTrigger,
  //   loading
  // });
  // debugDataSeparation(mergedCases, 'MergedCases');

  if (loading && mergedCases.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      </div>
    );
  }

  const caseGroups = groupCasesByTime(mergedCases);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {error && !error.includes('Failed to fetch') && (
        <div className="flex-shrink-0 p-3 mx-3 mt-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="mt-1 text-xs text-red-600 hover:text-red-800 underline">Dismiss</button>
        </div>
      )}

      {titleGenStatus.message && (
        <div className={`flex-shrink-0 p-2 mx-3 mt-2 border rounded-lg ${
          titleGenStatus.type === "error"
            ? "bg-red-50 border-red-200 text-red-700"
            : titleGenStatus.type === "success"
            ? "bg-green-50 border-green-200 text-green-700"
            : "bg-blue-50 border-blue-200 text-blue-700"
        }`}>
          <p className="text-xs">{titleGenStatus.message}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {hasUnsavedNewChat && (
          <div className="space-y-1 pb-2">
            <ConversationItem
              key="__new_chat__"
              session={{ session_id: 'new', created_at: new Date().toISOString(), status: 'active', last_activity: new Date().toISOString(), metadata: {} } as any}
              title="New Chat"
              isActive={!activeCaseId}
              isUnsavedNew={true}
              onSelect={() => onNewSession('')}
              onDelete={undefined}
              onRename={undefined}
            />
          </div>
        )}

        {mergedCases.length === 0 && !error?.includes('Failed to fetch') ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-gray-500 mb-3">No conversations yet</p>
            <p className="text-xs text-gray-400">Click "New chat" to start your first conversation</p>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {renderCaseGroup('Pinned', caseGroups.pinned)}
            {renderCaseGroup('Today', caseGroups.today)}
            {renderCaseGroup('7 Days', caseGroups.sevenDays)}
            {renderCaseGroup('30 Days', caseGroups.thirtyDays)}
            {renderCaseGroup('Older', caseGroups.older)}
          </div>
        )}
      </div>
    </div>
  );
}

export default ConversationsList;