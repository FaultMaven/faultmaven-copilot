/**
 * Case-title precedence — resolved in ONE place.
 *
 * A case's display title can come from more than one source, and the order they
 * win in must be identical everywhere it is read (the sidebar list, the active-case
 * header). Re-deriving that order at each call site is how titles drift; this
 * selector is the single definition of it.
 *
 * Precedence:
 *   1. `conversationTitles[caseId]` — the client store's title map. This is the
 *      authoritative client source: `SidePanelApp.onCaseTitleChange` writes it
 *      synchronously on rename and on smart-title generation (and rolls it back if
 *      the backend PUT fails), so it always reflects the latest user/system intent.
 *   2. the backend `UserCase.title` — the server title (auto-generated `Case-MMDD-N`
 *      for cases the user has not renamed), used until the store has an entry.
 *   3. a caller-supplied `fallback` (`'Loading…'`, `'Untitled Case'`).
 *
 * Resolving store-first against a SINGLE synchronously-updated source is what
 * prevents "title reversion": renaming one case can never revert another case's
 * freshly generated title, because no read consults a mirror that lags a render
 * behind. (An earlier component-local title mirror existed for that reason and has
 * been removed — the store is authoritative, so the mirror was redundant.)
 *
 * The first source with non-whitespace content wins and is returned verbatim
 * (untrimmed), preserving the exact stored/backend string for display.
 */
export function selectCaseTitle(
  sources: { store?: string | null; backend?: string | null },
  fallback: string
): string {
  if (sources.store && sources.store.trim()) return sources.store;
  if (sources.backend && sources.backend.trim()) return sources.backend;
  return fallback;
}
