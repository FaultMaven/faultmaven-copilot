import React, { useState, useEffect, useCallback } from 'react';
import { UserCase, getUserCases, DEFAULT_CASE_LIST_LIMIT, deleteCase as deleteCaseApi, generateCaseTitle, updateCaseTitle as apiUpdateCaseTitle } from '../../../lib/api';
import { ConversationItem } from './ConversationItem';
import LoadingSpinner from './LoadingSpinner';
import { HttpError, extractErrorMessage } from '../../../lib/errors/http-error';
import {
  sanitizeBackendCases,
  validateStateIntegrity,
  isOptimisticId,
  type RealCase
} from '../../../lib/utils/data-integrity';
import { idMappingManager } from '../../../lib/optimistic';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('ConversationsList');

const COLLAPSED_GROUPS_STORAGE_KEY = 'fm-copilot:collapsedCaseGroups';

const CASE_GROUP_KEYS = ['pinned', 'active', 'completed'] as const;
type CaseGroupKey = typeof CASE_GROUP_KEYS[number];

const isCaseGroupKey = (value: unknown): value is CaseGroupKey =>
  typeof value === 'string' && (CASE_GROUP_KEYS as readonly string[]).includes(value);

function loadCollapsedGroups(): Set<CaseGroupKey> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isCaseGroupKey));
  } catch {
    return new Set();
  }
}

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
  onCaseTitleChange,
  pinnedCases = new Set(),
  onPinToggle
}: ConversationsListProps) {
  const [cases, setCases] = useState<RealCase[]>([]); // STRICT: Only real cases from backend
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caseTitles, setCaseTitles] = useState<Record<string, string>>({});
  const [titleGenStatus, setTitleGenStatus] = useState<{ message: string; type: 'success' | 'info' | 'error' | '' }>({ message: "", type: "" });

  // Track recently deleted cases to prevent them from reappearing due to backend issues
  const [recentlyDeleted, setRecentlyDeleted] = useState<Set<string>>(new Set());

  const [collapsedGroups, setCollapsedGroups] = useState<Set<CaseGroupKey>>(loadCollapsedGroups);

  const toggleGroupCollapsed = useCallback((groupKey: CaseGroupKey) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      try {
        localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage unavailable (e.g. private mode) — preference stays in-memory only
      }
      return next;
    });
  }, []);

  useEffect(() => { loadCases(); }, []);
  useEffect(() => { if (refreshTrigger > 0) loadCases(); }, [refreshTrigger]);

  // Sync parent conversationTitles changes to local caseTitles state
  useEffect(() => {
    if (conversationTitles && Object.keys(conversationTitles).length > 0) {
      log.debug('Syncing conversation titles from parent', { count: Object.keys(conversationTitles).length });
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

  const loadCases = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await getUserCases({ limit: DEFAULT_CASE_LIST_LIMIT, offset: 0 });

      // ✅ PERFORMANCE WIN: Direct object access instead of JSON.stringify
      // JSON.stringify is computationally expensive and unnecessary
      log.debug('Fetched cases from API', {
        count: list?.length || 0
      });

      // DEFENSIVE: Strictly sanitize backend data
      const sanitizedRealCases = sanitizeBackendCases(list || [], 'loadCases');

      // Filter out recently deleted cases (defensive against backend bugs)
      const filteredCases = sanitizedRealCases.filter(c => !recentlyDeleted.has(c.case_id));

      if (filteredCases.length < sanitizedRealCases.length) {
        log.info('Filtered recently deleted cases', {
          received: sanitizedRealCases.length,
          filtered: filteredCases.length,
          removedCount: sanitizedRealCases.length - filteredCases.length
        });
      }

      setCases(filteredCases); // Store only real cases in state

      log.debug('Backend cases stored in state', { count: filteredCases.length });

      // ARCHITECTURAL FIX: Notify parent with ONLY real backend cases (no optimistic contamination)
      onCasesLoaded?.(sanitizedRealCases);
    } catch (err: any) {
      const full = err instanceof Error ? err.message : String(err);
      log.error('Failed to load cases', err);

      // Special handling for rate limit errors - don't spam retries
      if (err.name === 'RateLimitError' || err.status === 429) {
        const retryAfter = err.retryAfter || 60;
        log.warn('Rate limited', { retryAfter });
        setError(`Rate limit reached. Please wait ${retryAfter} seconds before refreshing.`);

        // Don't clear cases on rate limit - keep showing existing data
        // onCasesLoaded?.([]) - DON'T notify parent, keep existing state
      } else {
        setError(`Failed to list chats: ${full}`);
        setCases([]);

        // Still notify parent even on error (with empty array)
        onCasesLoaded?.([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const getCaseTitle = (c: UserCase): string => {
    // Priority: parent prop (always current) > local state > backend case object.
    // conversationTitles (parent) is checked first because caseTitles (local)
    // syncs via useEffect which can be one render behind during batched updates.
    // This prevents title reversion when renaming one case while another case
    // has a recently auto-generated title.
    const t = (conversationTitles && conversationTitles[c.case_id])
      || caseTitles[c.case_id]
      || c.title;
    if (t && t.trim()) return t;

    return c.title || 'Untitled Case';
  };

  const updateCaseTitle = (caseId: string, title: string) => {
    log.debug('Updating case title in local state', { caseId, title });
    setCaseTitles(prev => ({ ...prev, [caseId]: title }));
  };

  const handleRenameCase = async (caseId: string, newTitle: string) => {
    const title = (newTitle || '').trim();
    if (!title) return;

    // ✅ CONSOLIDATED: Single log instead of 3 separate logs
    log.info('Case title renamed', { caseId, newTitle: title });

    // OPTIMISTIC UPDATE: Update local state immediately
    updateCaseTitle(caseId, title);

    // Notify parent component - parent handles backend sync
    onCaseTitleChange?.(caseId, title);

    // NOTE: Backend sync is now handled by parent (SidePanelApp.handleOptimisticTitleUpdate)
    // This prevents duplicate API calls (previously we called API here AND parent called it)
  };

  const handleGenerateTitle = async (caseId: string, sessionIdGuess?: string) => {
    try {
      // ARCHITECTURAL FIX: Resolve optimistic IDs to real IDs for API calls
      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;

      log.info('Generating smart title', {
        caseId: resolvedCaseId,
        isOptimistic: isOptimisticId(caseId)
      });

      const { title, source } = await generateCaseTitle(resolvedCaseId, { max_words: 8 });

      const newTitle = (title || '').trim();
      if (!newTitle) {
        log.debug('Smart title generation returned empty', { reason: 'insufficient_context' });
        setTitleGenStatus({ message: "More conversation needed for a meaningful title", type: "info" });
        return;
      }

      // ✅ SENTRY BREADCRUMB: This info log will be attached to error reports
      log.info('Smart title generated', { caseId, source });

      // Update local state — backend already persisted the title
      updateCaseTitle(caseId, newTitle);
      // Mark title source so auto-generation doesn't overwrite it.
      // Pass through onCaseTitleChange which updates titleSources in parent.
      // The redundant PUT is harmless (idempotent, same title) and keeps the
      // parent's state consistent.
      onCaseTitleChange?.(caseId, newTitle);

      // Show different messages based on whether title was newly generated or already existed
      if (source === 'existing') {
        setTitleGenStatus({ message: "Title set previously", type: "info" });
      } else {
        setTitleGenStatus({ message: "Title generated successfully", type: "success" });
      }
    } catch (e: any) {
      const errorMessage = e?.message || 'Title generation failed';
      log.warn('Smart title generation failed', { error: errorMessage, caseId });

      // Display the exact backend error message to user (no interpretation)
      // Backend handles validation and provides user-friendly messages
      setTitleGenStatus({
        message: errorMessage,  // Show backend message as-is
        type: "info"  // Treat backend validation messages as info, not errors
      });
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    try {
      // Optimistically remove from UI immediately for better UX
      setCases(prev => prev.filter(c => c.case_id !== caseId));

      log.info('Deleting case', { caseId });

      await deleteCaseApi(caseId);

      // Success - case deleted
      log.info('Case deleted successfully', { caseId });

      // Add to recently deleted set to prevent it from reappearing if backend is slow to update
      setRecentlyDeleted(prev => new Set(prev).add(caseId));

      // Auto-clear from recentlyDeleted after 5 seconds
      setTimeout(() => {
        setRecentlyDeleted(prev => {
          const newSet = new Set(prev);
          newSet.delete(caseId);
          log.debug('Auto-cleared from deletion filter', { caseId });
          return newSet;
        });
      }, 5000);

      // Notify parent and handle navigation
      const remaining = cases.filter(c => c.case_id !== caseId);
      try {
        if (onAfterDelete) {
          onAfterDelete(caseId, remaining);
        }
      } catch (err) {
        log.warn('onAfterDelete callback failed', { error: err, caseId });
      }

      // If we deleted the active case, auto-switch to most recent remaining; else start new
      try {
        if (activeCaseId && activeCaseId === caseId) {
          const sorted = [...remaining].sort((a,b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
          const next = sorted[0];
          if (next && next.case_id) {
            log.info('Auto-switching to next case after delete', { nextCaseId: next.case_id });
            if (onCaseSelect) {
              onCaseSelect(next.case_id);
            }
          } else {
            log.info('No remaining cases, starting new session');
            if (onNewSession) {
              onNewSession('');
            }
          }
        }
      } catch (err) {
        log.warn('Navigation after delete failed', { error: err, caseId });
      }

      // Refresh from server to ensure list reflects backend state
      try {
        await loadCases();
      } catch (err) {
        log.warn('Failed to refresh cases after delete', { error: err });
      }
    } catch (e: unknown) {
      // Check if this is a 409 Conflict (duplicate request) using structured error
      if (e instanceof HttpError && e.is(409)) {
        log.warn('Delete request was a duplicate, case may already be deleted', { caseId });

        // Don't restore the case to UI - it's likely already deleted or being deleted
        // Add to recently deleted to prevent reappearance
        setRecentlyDeleted(prev => new Set(prev).add(caseId));

        // Auto-clear after a longer delay for duplicate errors
        setTimeout(() => {
          setRecentlyDeleted(prev => {
            const newSet = new Set(prev);
            newSet.delete(caseId);
            return newSet;
          });
          // Refresh to get accurate state
          loadCases().catch((err) => {
            log.warn('Failed to refresh cases after duplicate delete', { error: err });
          });
        }, 3000);

        // Show user-friendly message
        setError('This case was recently deleted or is already being processed. Refreshing...');
        setTimeout(() => setError(null), 3000);

        return; // Don't restore UI or show error
      }

      // For other errors, restore the case to the UI and show error
      const errorMessage = extractErrorMessage(e);
      log.error('Case deletion failed', { caseId, error: errorMessage });

      // Re-fetch to ensure UI reflects actual backend state
      try {
        await loadCases();
        setError(`Failed to delete case: ${errorMessage}`);
        setTimeout(() => setError(null), 5000);
      } catch (err) {
        log.warn('Failed to refresh cases after error', { error: err });
        setError(`Failed to delete case: ${errorMessage}`);
        setTimeout(() => setError(null), 5000);
      }
    }
  };

  const groupCasesByState = (items: UserCase[]) => {
    const groups = {
      pinned: [] as UserCase[],
      active: [] as UserCase[],
      completed: [] as UserCase[],
    };

    const sortByRecent = (a: UserCase, b: UserCase) =>
      new Date(b.updated_at || b.created_at || 0).getTime() -
      new Date(a.updated_at || a.created_at || 0).getTime();

    items.filter(c => c && c.case_id).forEach(c => {
      if (pinnedCases.has(c.case_id)) {
        groups.pinned.push(c);
        return;
      }

      const status = c.state || 'inquiry';
      if (status === 'resolved' || status === 'closed') groups.completed.push(c);
      else groups.active.push(c); // inquiry + investigating
    });

    // Sort each group by most recent first
    groups.pinned.sort(sortByRecent);
    groups.active.sort(sortByRecent);
    groups.completed.sort(sortByRecent);

    return groups;
  };

  const handlePinToggle = (caseId: string) => {
    onPinToggle?.(caseId);
  };

  const renderCaseGroup = (groupKey: CaseGroupKey, title: string, items: UserCase[]) => {
    if (items.length === 0) return null;
    const isCollapsed = collapsedGroups.has(groupKey);
    const panelId = `case-group-${groupKey}`;
    const headerId = `case-group-${groupKey}-header`;
    return (
      <div key={groupKey}>
        <h3 id={headerId} className="m-0">
          <button
            type="button"
            onClick={() => toggleGroupCollapsed(groupKey)}
            aria-expanded={!isCollapsed}
            aria-controls={panelId}
            className="w-full flex items-center justify-between gap-2 px-3 py-0.5 text-xs font-semibold text-fm-text-tertiary uppercase tracking-wider hover:text-fm-text-primary transition-colors select-none"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <svg
                className={`w-3 h-3 flex-shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="truncate">{title}</span>
            </span>
            <span className="text-[10px] font-medium text-fm-text-tertiary/70 normal-case tracking-normal flex-shrink-0">
              {items.length}
            </span>
          </button>
        </h3>
        {!isCollapsed && (
          <div id={panelId} role="region" aria-labelledby={headerId}>
            {items.map((c) => (
              <ConversationItem
                key={c.case_id}
                session={{ session_id: c.case_id, created_at: c.created_at || '', status: 'active', last_activity: c.updated_at || '', metadata: {} } as any}
                title={getCaseTitle(c)}
                isActive={Boolean(activeCaseId && c.case_id === activeCaseId)}
                isUnsavedNew={false}
                isPinned={pinnedCases.has(c.case_id)}
                messageCount={c.message_count || 0}
                onSelect={(id) => onCaseSelect && onCaseSelect(id)}
                onDelete={(id) => handleDeleteCase(id)}
                onRename={(id, t) => handleRenameCase(id, t)}
                onGenerateTitle={(id) => handleGenerateTitle(id, (c as any).session_id || activeSessionId)}
                onPin={onPinToggle ? () => handlePinToggle(c.case_id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const mergedCases = cases;

  // VALIDATION: Check state integrity
  const currentState = {
    conversations: undefined, // We don't have access to this here, but could be passed down
    conversationTitles
  };
  validateStateIntegrity(currentState, 'ConversationsList');

  if (loading && mergedCases.length === 0) {
    return (
      <div className={`flex flex-col min-h-0 ${className}`}>
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      </div>
    );
  }

  const caseGroups = groupCasesByState(mergedCases);

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {error && !error.includes('Failed to fetch') && (
        <div className="flex-shrink-0 p-3 mx-3 mt-2 bg-fm-critical-bg border border-fm-critical-border rounded-lg">
          <p className="text-xs text-fm-critical">{error}</p>
          <button onClick={() => setError(null)} className="mt-1 text-xs text-fm-critical hover:text-fm-text-primary underline">Dismiss</button>
        </div>
      )}

      {titleGenStatus.message && (
        <div className={`flex-shrink-0 p-2 mx-3 mt-2 border rounded-lg ${
          titleGenStatus.type === "error"
            ? "bg-fm-critical-bg border-fm-critical-border text-fm-critical"
            : titleGenStatus.type === "success"
            ? "bg-fm-success-bg border-fm-success-border text-fm-success"
            : "bg-fm-accent-soft border-fm-accent-border text-fm-accent"
        }`}>
          <p className="text-xs">{titleGenStatus.message}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {hasUnsavedNewChat && (() => {
          const now = new Date();
          const yy = String(now.getFullYear()).slice(2);
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          return (
            <div className="space-y-1 pb-2">
              <ConversationItem
                key="__new_chat__"
                session={{ session_id: 'new', created_at: now.toISOString(), status: 'active', last_activity: now.toISOString(), metadata: {} } as any}
                title={`Case-${yy}${mm}${dd}-?`}
                isActive={!activeCaseId}
                isUnsavedNew={true}
                onSelect={() => onNewSession('')}
                onDelete={undefined}
                onRename={undefined}
              />
            </div>
          );
        })()}

        {mergedCases.length === 0 && !error?.includes('Failed to fetch') ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-fm-text-tertiary mb-3">No cases yet</p>
            <p className="text-xs text-fm-text-secondary">{`Click "New Case" to start your first case`}</p>
          </div>
        ) : (
          <div className="space-y-3 pb-6">
            {renderCaseGroup('pinned', 'Pinned', caseGroups.pinned)}
            {renderCaseGroup('active', 'Active', caseGroups.active)}
            {renderCaseGroup('completed', 'Completed', caseGroups.completed)}
          </div>
        )}
      </div>
    </div>
  );
}

export default ConversationsList;
