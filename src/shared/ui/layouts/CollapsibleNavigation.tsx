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

  const DashboardIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
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
        className={`flex-shrink-0 bg-fm-base border-r border-fm-border flex flex-col h-full ${TRANSITION.ALL} ${TRANSITION.DURATION}`}
        style={{ width: NAVIGATION_WIDTH.COLLAPSED }}
      >
        {/* Top: Logo + Toggle */}
        <div className="flex-shrink-0 flex flex-col items-center pt-3 pb-2 gap-1 border-b border-fm-border">
          <img
            src="/icon/square-transparent.svg"
            alt="FM"
            className="w-7 h-7"
          />
          <button
            onClick={onToggleCollapse}
            className={`${collapsedBtnClass} text-fm-text-tertiary hover:text-fm-text-primary hover:bg-white/5 mt-1`}
            title="Expand sidebar"
          >
            <ExpandIcon />
          </button>
        </div>

        {/* Middle: Action icons */}
        <div className="flex-1 flex flex-col items-center pt-3 gap-2">
          {/* Dashboard */}
          {dashboardUrl && onOpenDashboard && (
            <button
              onClick={onOpenDashboard}
              className={`${collapsedBtnClass} text-fm-text-secondary hover:text-fm-accent hover:bg-fm-accent/10 border border-fm-border-subtle`}
              title="Open Dashboard"
            >
              <DashboardIcon />
            </button>
          )}

          {/* New Case */}
          <button
            onClick={onNewChat}
            disabled={hasUnsavedNewChat}
            className={`${collapsedBtnClass} bg-fm-accent-gradient text-white shadow-fm-glow hover:opacity-90 disabled:opacity-50`}
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
            className={`${collapsedBtnClass} text-fm-text-tertiary hover:text-fm-text-primary hover:bg-white/5`}
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            onClick={onLogout}
            className={`${collapsedBtnClass} text-fm-text-tertiary hover:text-fm-text-primary hover:bg-white/5`}
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
      className={`flex-shrink-0 bg-fm-base border-r border-fm-border flex flex-col h-full ${TRANSITION.ALL} ${TRANSITION.DURATION}`}
      style={{ width: NAVIGATION_WIDTH.EXPANDED, maxWidth: NAVIGATION_WIDTH.EXPANDED_MAX }}
    >
      {/* Header: Logo + Collapse toggle */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/icon/design-transparent.svg"
              alt="FaultMaven"
              className="h-6 w-auto"
            />
          </div>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 text-fm-text-tertiary hover:text-white transition-colors"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex-shrink-0 px-4 space-y-1.5 mb-3">
        {/* Open Dashboard — outlined secondary, sits above the primary CTA */}
        {dashboardUrl && onOpenDashboard && (
          <button
            onClick={onOpenDashboard}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-fm-border-subtle text-fm-text-secondary hover:text-fm-text-primary hover:border-fm-border hover:bg-white/5 transition-colors group"
            title="Open Dashboard"
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            <span className="text-[12px] font-medium">Open Dashboard</span>
            <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-50 group-hover:opacity-80 transition-opacity ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}

        {/* New Case — primary CTA */}
        <button
          onClick={onNewChat}
          disabled={hasUnsavedNewChat}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-fm-accent text-white hover:bg-fm-accent-strong font-semibold disabled:opacity-50 shadow-sm transition-colors"
          title="Start new case"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-[13px]">New Case</span>
        </button>
      </div>

      {/* Case list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <ErrorBoundary
          fallback={
            <div className="p-3 bg-fm-critical-bg border border-fm-critical-border rounded-lg m-3">
              <p className="text-sm text-fm-critical">Error loading conversations</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-3 py-1 text-xs bg-fm-surface text-fm-critical rounded hover:bg-fm-elevated"
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
            onFirstCaseDetected={() => { }}
            onAfterDelete={onAfterDelete}
            onCasesLoaded={onCasesLoaded}
            pendingCases={optimisticCases}
            onCaseTitleChange={onCaseTitleChange}
            pinnedCases={pinnedCases}
            onPinToggle={onPinToggle}
          />
        </ErrorBoundary>
      </div>

      {/* Footer: Settings + Logout (compact icon row) */}
      <div className="flex-shrink-0 flex items-center justify-center gap-2 px-2 py-2 border-t border-fm-border">
        <button
          onClick={() => {
            if (typeof browser !== 'undefined' && browser.runtime) {
              browser.runtime.openOptionsPage();
            }
          }}
          className="w-6 h-6 flex items-center justify-center text-fm-text-tertiary hover:text-fm-text-primary hover:bg-white/5 rounded transition-colors"
          title="Settings"
        >
          <SettingsIcon />
        </button>
        <button
          onClick={onLogout}
          className="w-6 h-6 flex items-center justify-center text-fm-text-tertiary hover:text-fm-text-primary hover:bg-white/5 rounded transition-colors"
          title="Logout"
        >
          <LogoutIcon />
        </button>
      </div>
    </div>
  );
}
