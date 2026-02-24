// src/shared/ui/layouts/CollapsibleNavigation.tsx
/**
 * Collapsible Navigation Component — ADR 003 Dark Theme
 *
 * ChatGPT-style collapsible sidebar:
 * - Expanded: 220px with logo + text labels + case list
 * - Collapsed: 52px icon-only rail with tooltip titles
 * - Toggle button always visible in both states
 */

import React from 'react';
import { browser } from 'wxt/browser';
import { ErrorBoundary } from '../components/ErrorBoundary';
import ConversationsList from '../components/ConversationsList';
import { NAVIGATION_WIDTH, TRANSITION } from './constants';

export interface CollapsibleNavigationProps {
  // Collapse state
  isCollapsed: boolean;
  onToggleCollapse: () => void;

  // Active states
  activeTab: 'copilot';
  activeCaseId?: string;
  sessionId?: string;
  hasUnsavedNewChat: boolean;

  // User info
  isAdmin: boolean;

  // Conversations
  conversationTitles: Record<string, string>;
  optimisticCases: any[];
  pinnedCases: Set<string>;
  refreshTrigger: number;

  // Capabilities
  dashboardUrl?: string;

  // Callbacks
  onTabChange: (tab: 'copilot') => void;
  onOpenDashboard?: () => void;
  onCaseSelect: (caseId: string) => void;
  onNewChat: () => void;
  onLogout: () => void;
  onCaseTitleChange: (caseId: string, newTitle: string) => void;
  onPinToggle: (caseId: string) => void;
  onAfterDelete?: (deletedCaseId: string, remaining: Array<{ case_id: string; updated_at?: string; created_at?: string }>) => void;
  onCasesLoaded?: (cases: any[]) => void;
}

export function CollapsibleNavigation({
  isCollapsed,
  onToggleCollapse,
  activeTab,
  activeCaseId,
  sessionId,
  hasUnsavedNewChat,
  isAdmin,
  conversationTitles,
  optimisticCases,
  pinnedCases,
  refreshTrigger,
  dashboardUrl,
  onTabChange,
  onOpenDashboard,
  onCaseSelect,
  onNewChat,
  onLogout,
  onCaseTitleChange,
  onPinToggle,
  onAfterDelete,
  onCasesLoaded,
}: CollapsibleNavigationProps) {

  // --- Icon components (shared between collapsed and expanded) ---
  const NewCaseIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );

  const KBIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );

  const SettingsIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );

  const LogoutIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );

  const ExpandIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );

  const CollapseIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );

  // Collapsed icon button style
  const collapsedBtnClass = "w-9 h-9 flex items-center justify-center rounded-lg transition-colors";

  // --- Collapsed: icon-only rail ---
  if (isCollapsed) {
    return (
      <div
        className={`flex-shrink-0 bg-fm-bg border-r border-fm-border flex flex-col h-full ${TRANSITION.ALL} ${TRANSITION.DURATION}`}
        style={{ width: NAVIGATION_WIDTH.COLLAPSED }}
      >
        {/* Top: Logo + Toggle */}
        <div className="flex-shrink-0 flex flex-col items-center pt-3 pb-2 gap-1 border-b border-fm-border">
          <img
            src="/icon/square-dark.svg"
            alt="FM"
            className="w-7 h-7"
          />
          <button
            onClick={onToggleCollapse}
            className={`${collapsedBtnClass} text-fm-dim hover:text-fm-text hover:bg-fm-surface mt-1`}
            title="Expand sidebar"
          >
            <ExpandIcon />
          </button>
        </div>

        {/* Middle: Action icons */}
        <div className="flex-1 flex flex-col items-center pt-3 gap-2">
          {/* KB Dashboard */}
          {dashboardUrl && onOpenDashboard && (
            <button
              onClick={onOpenDashboard}
              className={`${collapsedBtnClass} text-fm-dim hover:text-fm-text hover:bg-fm-surface`}
              title="KB Dashboard"
            >
              <KBIcon />
            </button>
          )}

          {/* New Case */}
          <button
            onClick={onNewChat}
            disabled={hasUnsavedNewChat}
            className={`${collapsedBtnClass} bg-fm-blue text-white hover:bg-fm-active disabled:opacity-50`}
            title="New Case"
          >
            <NewCaseIcon />
          </button>
        </div>

        {/* Bottom: Settings + Logout */}
        <div className="flex-shrink-0 flex flex-col items-center pb-3 gap-2 border-t border-fm-border pt-2">
          <button
            onClick={() => {
              if (typeof browser !== 'undefined' && browser.runtime) {
                browser.runtime.openOptionsPage();
              }
            }}
            className={`${collapsedBtnClass} text-fm-dim hover:text-fm-text hover:bg-fm-surface`}
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            onClick={onLogout}
            className={`${collapsedBtnClass} text-fm-dim hover:text-fm-text hover:bg-fm-surface`}
            title="Logout"
          >
            <LogoutIcon />
          </button>
        </div>
      </div>
    );
  }

  // --- Expanded: full sidebar with case list ---
  return (
    <div
      className={`flex-shrink-0 bg-fm-bg border-r border-fm-border flex flex-col h-full ${TRANSITION.ALL} ${TRANSITION.DURATION}`}
      style={{ width: NAVIGATION_WIDTH.EXPANDED, maxWidth: NAVIGATION_WIDTH.EXPANDED_MAX }}
    >
      {/* Header: Logo + Collapse toggle */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-fm-border">
        <div className="flex items-center justify-between">
          <img
            src="/icon/square-dark.svg"
            alt="FaultMaven"
            className="w-7 h-7 flex-shrink-0"
          />
          <button
            onClick={onToggleCollapse}
            className="p-1.5 text-fm-dim hover:text-fm-text hover:bg-fm-surface rounded-lg transition-colors flex-shrink-0"
            title="Collapse sidebar"
          >
            <CollapseIcon />
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex-shrink-0 px-3 py-2 space-y-1.5">
        {/* KB Dashboard */}
        {dashboardUrl && onOpenDashboard && (
          <button
            onClick={onOpenDashboard}
            className="w-full flex items-center gap-2.5 py-2 px-3 rounded-lg transition-colors text-fm-text hover:bg-fm-surface"
            title="Open Knowledge Base Dashboard"
          >
            <KBIcon />
            <span className="text-sm font-medium truncate">KB Dashboard</span>
            <svg className="w-3 h-3 ml-auto text-fm-dim flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}

        {/* New Case */}
        <button
          onClick={onNewChat}
          disabled={hasUnsavedNewChat}
          className="w-full flex items-center gap-2.5 py-2 px-3 rounded-lg transition-colors bg-fm-blue text-white hover:bg-fm-active disabled:opacity-50"
          title="Start new case"
        >
          <NewCaseIcon />
          <span className="text-sm font-medium truncate">New Case</span>
        </button>
      </div>

      {/* Case list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <ErrorBoundary
          fallback={
            <div className="p-3 bg-fm-red-light border border-fm-red-border rounded-lg m-3">
              <p className="text-sm text-fm-red">Error loading conversations</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-3 py-1 text-xs bg-fm-surface text-fm-red rounded hover:bg-fm-elevated"
              >
                Retry
              </button>
            </div>
          }
        >
          <ConversationsList
            activeSessionId={sessionId}
            activeCaseId={activeCaseId}
            onCaseSelect={onCaseSelect}
            onNewSession={(id) => {
              if (id === '') {
                onNewChat();
              }
            }}
            conversationTitles={conversationTitles}
            hasUnsavedNewChat={hasUnsavedNewChat}
            refreshTrigger={refreshTrigger}
            className="h-full"
            collapsed={false}
            onFirstCaseDetected={() => {}}
            onAfterDelete={onAfterDelete}
            onCasesLoaded={onCasesLoaded}
            pendingCases={optimisticCases}
            onCaseTitleChange={onCaseTitleChange}
            pinnedCases={pinnedCases}
            onPinToggle={onPinToggle}
          />
        </ErrorBoundary>
      </div>

      {/* Footer: Settings + Logout */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-fm-border space-y-1">
        <button
          onClick={() => {
            if (typeof browser !== 'undefined' && browser.runtime) {
              browser.runtime.openOptionsPage();
            }
          }}
          className="w-full flex items-center gap-2.5 py-2 px-3 text-fm-text hover:bg-fm-surface rounded-lg transition-colors"
          title="Settings"
        >
          <SettingsIcon />
          <span className="text-sm font-medium">Settings</span>
        </button>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 py-2 px-3 text-fm-text hover:bg-fm-surface rounded-lg transition-colors"
          title="Logout"
        >
          <LogoutIcon />
          <span className="text-sm font-medium">Logout</span>
        </button>
      </div>
    </div>
  );
}
