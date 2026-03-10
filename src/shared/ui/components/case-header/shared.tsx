/**
 * Shared primitives for case header components
 *
 * SVG icons (Heroicons-style), DetailRow layout, SeverityChip, and helpers.
 * All icons accept className for Tailwind sizing/coloring.
 */

import React from 'react';
import type { CaseUIResponse, UserCase } from '../../../../types/case';

// ==================== SVG Icons ====================

interface IconProps {
  className?: string;
}

/** Inquiry phase icon */
export const ClipboardListIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
);

/** Investigating phase icon */
export const MagnifyingGlassIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

/** Resolved phase icon / confirmed marker */
export const CheckCircleIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

/** Closed phase icon */
export const LockClosedIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

/** Expand/collapse chevron */
export const ChevronDownIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

/** Drill-down indicator */
export const ChevronRightIcon: React.FC<IconProps> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

/** File attachment icon */
export const PaperClipIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
  </svg>
);

/** Wrench icon for treatment/resolving stage */
export const WrenchIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.383 5.383a1.5 1.5 0 01-2.12-2.121l5.382-5.383m0 0a5.25 5.25 0 017.56-7.04l-3.53 3.53a.75.75 0 000 1.06l1.06 1.06a.75.75 0 001.061 0l3.53-3.53a5.25 5.25 0 01-7.04 7.56" />
  </svg>
);

/** Bolt icon for mitigation stage */
export const BoltIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
  </svg>
);

/** Small filled circle for completed milestones */
export const FilledCircleIcon: React.FC<IconProps> = ({ className = 'w-2 h-2' }) => (
  <svg className={className} viewBox="0 0 8 8" fill="currentColor">
    <circle cx="4" cy="4" r="4" />
  </svg>
);

/** Small empty circle for incomplete milestones */
export const EmptyCircleIcon: React.FC<IconProps> = ({ className = 'w-2 h-2' }) => (
  <svg className={className} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="4" cy="4" r="3" />
  </svg>
);

// ==================== Phase Icon Lookup ====================

const PHASE_ICONS: Record<string, React.FC<IconProps>> = {
  inquiry: ClipboardListIcon,
  investigating: MagnifyingGlassIcon,
  resolved: CheckCircleIcon,
  closed: LockClosedIcon,
};

/** Get the icon component for a case phase */
export function getPhaseIcon(phase: string): React.FC<IconProps> {
  return PHASE_ICONS[phase] || ClipboardListIcon;
}

// ==================== Severity ====================

export const SEVERITY_CONFIG: Record<string, { label: string; colorClass: string; dotClass: string }> = {
  critical: { label: 'Critical', colorClass: 'text-fm-critical', dotClass: 'bg-fm-critical' },
  high: { label: 'High', colorClass: 'text-fm-warning', dotClass: 'bg-fm-warning' },
  medium: { label: 'Medium', colorClass: 'text-fm-info', dotClass: 'bg-fm-info' },
  low: { label: 'Low', colorClass: 'text-fm-success', dotClass: 'bg-fm-success' },
};

/** Two-tier severity fallback: UserCase.priority → inquiry severity_guess → null */
export function getSeverity(
  activeCase?: UserCase | null,
  caseData?: CaseUIResponse | null,
): string | null {
  if (activeCase?.priority && ['low', 'medium', 'high', 'critical'].includes(activeCase.priority)) {
    return activeCase.priority;
  }
  if (caseData && 'inquiry' in caseData && caseData.inquiry) {
    const confirmation = caseData.inquiry.problem_confirmation as Record<string, unknown> | null;
    const guess = confirmation?.severity_guess as string | undefined;
    if (guess && ['low', 'medium', 'high', 'critical'].includes(guess)) {
      return guess;
    }
  }
  return null;
}

/** Severity chip: colored dot + label */
export const SeverityChip: React.FC<{ severity: string | null }> = ({ severity }) => {
  if (!severity) return null;
  const config = SEVERITY_CONFIG[severity];
  if (!config) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-fm-xs font-medium ${config.colorClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  );
};

// ==================== DetailRow ====================

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

/** Key-value row for expanded header details. One line per item. */
export const DetailRow: React.FC<DetailRowProps> = ({
  label,
  children,
  expandable = false,
  expanded = false,
  onToggle,
}) => (
  <div
    className={`flex items-start gap-2 py-1 text-fm-sm ${expandable ? 'cursor-pointer hover:bg-fm-elevated/30 rounded' : ''}`}
    onClick={expandable ? onToggle : undefined}
  >
    <span className="text-fm-text-tertiary w-[76px] flex-shrink-0 text-fm-sm font-medium">
      {label}
    </span>
    <span className="text-fm-text-primary flex-1 min-w-0 truncate">{children}</span>
    {expandable && (
      <ChevronRightIcon
        className={`w-3.5 h-3.5 text-fm-text-tertiary flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      />
    )}
  </div>
);

// ==================== Helpers ====================

/** Format relative time from ISO timestamp */
export function formatTimeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Format duration in minutes to human-readable */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

/** Format file size in human-readable format */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
