import { useEffect, type RefObject } from 'react';

/**
 * Selector for elements that can receive keyboard focus. Excludes anything
 * explicitly removed from the tab order via tabindex="-1" (e.g. the modal
 * container itself, which is focusable programmatically but not via Tab).
 */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface UseFocusTrapOptions {
  /** Whether the trap is active (modal open). */
  isActive: boolean;
  /** Ref to the container whose focusable children should be trapped. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called when Escape is pressed while the trap is active. */
  onEscape?: () => void;
}

/**
 * Accessibility focus management for modal dialogs.
 *
 * While `isActive` is true this hook:
 * - moves focus into the container and remembers what had focus before,
 * - locks body scroll,
 * - cycles Tab / Shift+Tab within the container's focusable elements,
 * - invokes `onEscape` on the Escape key.
 *
 * When `isActive` becomes false (or the component unmounts) it restores body
 * scroll and returns focus to the previously focused element if it still
 * exists in the DOM.
 */
export function useFocusTrap({ isActive, containerRef, onEscape }: UseFocusTrapOptions): void {
  // Focus capture/restore + body scroll lock.
  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;

    // Save current focus only if it lives outside the modal, so we restore to
    // the element the user came from rather than something inside the modal.
    const activeEl = document.activeElement as HTMLElement | null;
    const previousActiveElement =
      activeEl && (!container || !container.contains(activeEl)) ? activeEl : null;

    container?.focus();
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = '';
      if (previousActiveElement && document.body.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    };
  }, [isActive, containerRef]);

  // Tab trapping + Escape handling.
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusable = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }

      if (e.key === 'Escape') {
        onEscape?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, containerRef, onEscape]);
}
