/**
 * App Bootstrap Latch
 *
 * Whether `initializeApp` — first-run status plus backend capabilities — has
 * already run on this page load. It describes the DOCUMENT, not the user, so
 * like `session-epoch` it is module state rather than store state: nothing
 * renders on it and nothing persists it.
 *
 * It exists because more than one component asks for the bootstrap. Since #240
 * split the extension's entry out of the shared UI, `ExtensionApp` bootstraps
 * before it will mount the panel and `CopilotPanel` bootstraps on mount — and
 * the entry ALSO renders a loading screen while `initializingCapabilities` is
 * true, so a second bootstrap unmounts the very component that asked for it:
 * mount → initializeApp → the flag goes true → the entry swaps the panel for
 * its loading screen → unmount → capabilities settle → the flag goes false →
 * remount → initializeApp → … The panel remounted for as long as the renderer
 * survived, refetching capabilities on every cycle, and the side-panel document
 * died under it (#251).
 *
 * This module deliberately imports NOTHING. `src/test/setup.ts` resets the
 * latch for every test, and an import that dragged the store — or the
 * capabilities manager — into that file would load them ahead of the `vi.mock`
 * factories in suites that stub them.
 */

let bootstrapped = false;

/** Whether the bootstrap has already run on this page load. */
export function hasAppBootstrapped(): boolean {
  return bootstrapped;
}

/** Record that the bootstrap has run. Called once, past the onboarding gate. */
export function markAppBootstrapped(): void {
  bootstrapped = true;
}

/**
 * Forget that the bootstrap ran.
 *
 * For tests: one module instance is shared by every case in a file, while each
 * case stands for a fresh page load.
 */
export function resetAppBootstrap(): void {
  bootstrapped = false;
}
