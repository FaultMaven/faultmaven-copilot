/**
 * Layout Constants — ADR 003 Side Panel Design
 *
 * Dimensions and tokens for the dual-mode sidebar system
 * and side panel layout architecture.
 */

/**
 * Inline Sidebar (Mode A) Widths
 * Per spec Section 4: 16-20px collapsed rail, 180px expanded list
 */
export const INLINE_SIDEBAR = {
  COLLAPSED_WIDTH: '52px',
  EXPANDED_WIDTH: '240px',
} as const;

/**
 * Overlay Drawer (Mode B) Widths
 * Per spec Section 4: 272px absolute positioned
 */
export const OVERLAY_DRAWER = {
  WIDTH: '272px',
} as const;

/**
 * Legacy navigation widths (kept for backward compat during transition)
 */
export const NAVIGATION_WIDTH = {
  EXPANDED: '240px',
  COLLAPSED: '52px',
  EXPANDED_MAX: '240px',
} as const;

/**
 * Transition Configuration
 */
export const TRANSITION = {
  DURATION: 'duration-200',
  ALL: 'transition-all',
  SIDEBAR_EASING: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/**
 * Responsive Breakpoints
 */
export const BREAKPOINTS = {
  MOBILE_MIN: '400px',
  MOBILE_MAX: '500px',
  TABLET: '700px',
} as const;

/**
 * Z-Index Layers — per spec Section 4
 */
export const Z_INDEX = {
  BASE: 'z-0',
  INLINE_SIDEBAR: 'z-10',
  OVERLAY_BACKDROP: 'z-[40]',
  OVERLAY_DRAWER: 'z-[50]',
  MODAL_BACKDROP: 'z-[60]',
  MODAL: 'z-[70]',
  TOAST: 'z-[80]',
} as const;

/**
 * Input Configuration
 */
import config from '../../../config';

export const INPUT_LIMITS = {
  DATA_MODE_LINE_THRESHOLD: config.inputLimits.dataModeLinesThreshold,
  MAX_QUERY_LENGTH: config.inputLimits.maxQueryLength,
  TEXTAREA_MIN_ROWS: config.inputLimits.textareaMinRows,
  TEXTAREA_MAX_ROWS: config.inputLimits.textareaMaxRows,
  MAX_FILE_SIZE: config.inputLimits.maxFileSize,
  ALLOWED_FILE_EXTENSIONS: config.inputLimits.allowedFileExtensions,
  ALLOWED_MIME_TYPES: config.inputLimits.allowedMimeTypes,
} as const;
