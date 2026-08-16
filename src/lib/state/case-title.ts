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
/**
 * The placeholder a case is born with when no title was supplied: the backend's
 * `Case-{YYMMDD}-{seq}`, plus the `Case-{MMDD}-{seq}` form it emitted before
 * 2026-01-28 — every case created before that day still carries the 4-digit
 * width. Mirrors `_DEFAULT_CASE_TITLE_RE` in the backend's
 * `modules/case/api/routes.py`; the two must accept the same set, because the
 * backend uses it to decide what it may overwrite and this uses it to decide
 * what it must not trust.
 *
 * Anchored on both ends so a real title that merely contains the shape
 * ("Re: Case-260101-1") is never treated as a placeholder.
 */
const PLACEHOLDER_CASE_TITLE = /^Case-(?:\d{4}|\d{6})-\d+$/;

export function isPlaceholderCaseTitle(title?: string | null): boolean {
  return !!title && PLACEHOLDER_CASE_TITLE.test(title.trim());
}

export function selectCaseTitle(
  sources: { store?: string | null; backend?: string | null },
  fallback: string
): string {
  // A placeholder in the store is never worth preferring over the backend.
  //
  // The store is meant to hold titles a user chose or explicitly generated, but
  // several paths have seeded it with whatever the backend last reported —
  // including the placeholder a case is born with. Since the store wins, one of
  // those seeds pins `Case-YYMMDD-N` ahead of the real title the server writes
  // later, and the sidebar shows the placeholder for a case that has been named.
  // Storage is persisted, so an entry written by an older build outlives the
  // code that wrote it; fixing the writers alone would leave existing installs
  // broken (fm#1069).
  //
  // Skipping it here is never worse than honouring it, for any store value: if
  // the store holds a placeholder, the backend holds either the same placeholder
  // (identical result) or a real title (strictly better). That includes the
  // absurd case of a user literally renaming a case to "Case-260101-1" — that
  // rename is persisted, so the backend carries it too.
  if (sources.store && sources.store.trim() && !isPlaceholderCaseTitle(sources.store)) {
    return sources.store;
  }
  if (sources.backend && sources.backend.trim()) return sources.backend;
  return fallback;
}
