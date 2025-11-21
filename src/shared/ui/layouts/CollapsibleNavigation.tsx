// src/shared/ui/layouts/CollapsibleNavigation.tsx
/**
 * Collapsible Navigation Component
 *
 * Implements the enhanced UI design spec for sidebar navigation:
 * - Expanded state: 250px wide with full menu
 * - Collapsed state: 20px wide with > expand button only
 * - Smooth transitions and state persistence
 *
 * Phase 1, Week 1 implementation (basic functionality)
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
  // Collapsed state (20px width) - only expand button
  if (isCollapsed) {
    return (
      <div className={`flex-shrink-0 bg-white border-r border-gray-200 ${TRANSITION.ALL} ${TRANSITION.DURATION}`} style={{ width: NAVIGATION_WIDTH.COLLAPSED }}>
        <div className="flex flex-col h-full">
          {/* Logo in collapsed state */}
          <div className="flex-shrink-0 p-4 border-b border-gray-200">
            <div className="flex items-center justify-center">
              <img
                src="/icon/design-light.svg"
                alt="FaultMaven Logo"
                className="h-8 w-auto"
              />
            </div>
          </div>

          {/* Collapsed navigation controls */}
          <div className="flex-1 p-3 space-y-3">
            {/* New Case button */}
            <button
              onClick={onNewChat}
              disabled={hasUnsavedNewChat}
              className="w-full h-10 flex items-center justify-center bg-blue-300 text-white rounded-lg hover:bg-blue-400 transition-colors disabled:opacity-50"
              title="New Case"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Expand button */}
            <button
              onClick={onToggleCollapse}
              className="w-full h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Expand Sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* User avatar in collapsed state */}
          <div className="flex-shrink-0 p-3 border-t border-gray-200">
            <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Expanded state (250px width) - full navigation
  return (
    <div className={`flex-shrink-0 bg-white border-r border-gray-200 ${TRANSITION.ALL} ${TRANSITION.DURATION}`} style={{ width: NAVIGATION_WIDTH.EXPANDED, maxWidth: NAVIGATION_WIDTH.EXPANDED_MAX }}>
      <div className="flex flex-col h-full">
        {/* Header with logo and collapse button */}
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
              onClick={onToggleCollapse}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Collapse Sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="flex-shrink-0 px-4 py-2 space-y-2">
          {/* Open Dashboard button */}
          {dashboardUrl && onOpenDashboard && (
            <button
              onClick={onOpenDashboard}
              className="w-full flex items-center gap-3 py-2.5 px-4 rounded-lg transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
              title="Open Knowledge Base Dashboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span className="text-sm font-medium">KB Dashboard</span>
              <svg className="w-3 h-3 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}

          {/* New Case button */}
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-3 py-2.5 px-4 rounded-lg transition-colors bg-blue-300 text-white hover:bg-blue-400"
            title="Start new case"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">New Case</span>
          </button>
        </div>

        {/* Conversations list */}
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

        {/* Footer: Settings and Logout */}
        <div className="flex-shrink-0 p-4 border-t border-gray-200 space-y-2">
          {/* Settings button */}
          <button
            onClick={() => {
              if (typeof browser !== 'undefined' && browser.runtime) {
                browser.runtime.openOptionsPage();
              }
            }}
            className="w-full flex items-center gap-3 py-2.5 px-4 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-medium">Settings</span>
          </button>

          {/* Logout button */}
          <button
            onClick={onLogout}
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
    </div>
  );
}
