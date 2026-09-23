#!/usr/bin/env node
/**
 * WHAT A CONTRACT PIN BUMP CROSSED — printed, never enforced.
 *
 * `api-types-drift` asserts the pinned `contractVersion` equals the version the
 * pinned ref serves. That is the CORRECTNESS leg and it is satisfied by a hop of
 * ANY size: 3.5.0 → 3.7.0 passes exactly as 3.5.0 → 3.6.0 does.
 *
 * It happened. A pin bump described as adopting 3.7.0's turn ordinal also
 * carried 3.6.0, in which `POST /knowledge/documents` stopped requiring
 * `platform_admin` unconditionally — an authorization change, fully green, named
 * nowhere in the pull request until a reviewer found it. Approving the
 * description would have approved something nobody was shown.
 *
 * IT NEVER FAILS. How many contracts a bump may cross is a judgement, and a
 * script answering it would make the agreement on the reviewer's behalf — the
 * same reason the API's breaking-change differ is advisory. This gate enforces
 * CONSENT, not currency; a disclosure serves consent, a threshold replaces it.
 *
 * ⚠️ IT SCREEN-SCRAPES. `contract_version.py` is a source file, not a published
 * artifact, so this reads `#` comments across the network and is coupled to
 * upstream prose. Every way that coupling can break resolves to SAY SO rather
 * than to reassure — see `describe()`. The durable fix is for the API to
 * publish the entries as data beside `openapi.json`; until then, silence and
 * confidence are the two outputs this must never produce by accident.
 *
 *     node scripts/report-contract-hop.mjs <base-ref>
 *
 * Exits 0 always. Prints nothing when there is nothing to say.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchored to the REPOSITORY, not the caller's cwd — the asymmetry
// `generate-api-types.mjs` documents next door. `git show <ref>:<path>` is
// always repo-root-relative, so a cwd-relative read here would throw ENOENT
// from a subdirectory while the git side quietly succeeded.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN_PATH = 'api-contract.pin.json';

function pinAt(ref) {
  try {
    // stderr silenced: an unreachable base is a normal outcome (a shallow
    // clone, a first commit), and git's "fatal:" reads as a failure when the
    // answer is simply "nothing to compare against".
    return JSON.parse(
      execFileSync('git', ['show', `${ref}:${PIN_PATH}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return null;
  }
}

/** `3.7.0` → `[3, 7, 0]`, so ordering is numeric rather than lexical. */
function parseVersion(version) {
  const parts = String(version ?? '').split('.').map((n) => Number.parseInt(n, 10));
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The entries strictly above `from` and at or below `to`.
 *
 * An entry ends at the next header OR at the first line that is not a comment,
 * and BOTH halves are load-bearing — each one alone has already shipped a bug.
 *
 * Without the not-a-comment half: the notes are not in version order (3.6.0
 * sits below 2.0.0, because "#1389 took 3.5.0 while this sat in review"), so the
 * last entry in the file has no header after it, a next-header-only rule runs it
 * to EOF, and `API_CONTRACT_VERSION` lands in the prose. That is what the first
 * version of this script printed.
 *
 * Without the next-header half: every subsequent header is itself a `#` line, so
 * the walk passes through all of them and the newest entry absorbs the whole
 * file below it — 528 lines for a single-contract hop, under a heading that said
 * "One contract adopted". That is what the second version printed.
 */
function entriesBetween(source, from, to) {
  const lines = source.split(/\r?\n/);
  const headers = [];
  lines.forEach((line, i) => {
    const match = /^#\s+(\d+\.\d+\.\d+)\s+[—-]\s/.exec(line);
    if (match) headers.push({ index: i, version: parseVersion(match[1]) });
  });

  const found = [];
  for (const [k, { index, version }] of headers.entries()) {
    // No `!version` guard: a header reaches `headers` only by matching
    // `\d+\.\d+\.\d+`, and `parseVersion` on that capture always yields three
    // integers — so the branch that used to sit here could never be taken. It
    // read as a real guard against an unparseable header and protected
    // nothing, which is worse than its absence: the next person to loosen the
    // header pattern would trust it.
    if (compare(version, from) <= 0 || compare(version, to) > 0) continue;
    // Both halves of the boundary, in one expression each: `limit` is the next
    // header (the ordering `headers` already has, so no lookup is needed), and
    // the loop condition is the not-a-comment half.
    const limit = headers[k + 1]?.index ?? lines.length;
    let end = index + 1;
    while (end < limit && (lines[end].startsWith('#') || lines[end].trim() === '')) {
      end += 1;
    }
    found.push({
      version,
      text: lines
        .slice(index, end)
        .map((l) => l.replace(/^#\s?/, ''))
        .join('\n')
        .trim(),
    });
  }
  // ‼ NEWEST FIRST. The notes are deliberately not in version order (the
  // docstring above says why), so walking `headers` emits whatever order the
  // file happens to have: on the real 6.2.0 -> 9.0.0 hop that was 8.0.0,
  // 7.2.0, 7.1.0, 7.0.0, 9.0.0 — the newest MAJOR last, behind a
  // 16,241-character entry.
  //
  // Sorting ASCENDING does not fix that and was the first attempt here: it
  // left 9.0.0 at character offset 21,108 of 22,691 — still last — and moved
  // the 16k entry to the FRONT, so a skimmer hit the wall immediately instead
  // of eventually. Measured both ways. Descending is what the argument
  // actually asks for: the change most likely to break a client is the one a
  // reviewer should meet first.
  found.sort((a, b) => compare(b.version, a.version));
  return found.map((entry) => entry.text);
}

/**
 * What to print. Separated from the fetching so it is testable, and written so
 * that EVERY uncertain state says it is uncertain.
 */
export function describe({ before, after, notes }) {
  if (!before || !after) return '';
  if (before.contractVersion === after.contractVersion) return '';

  const from = parseVersion(before.contractVersion);
  const to = parseVersion(after.contractVersion);
  const moved = `\`${before.contractVersion}\` → \`${after.contractVersion}\``;
  const header = `### API contract pin moved: ${moved}\n\n`;

  // A downgrade or an unparseable pair is reported and NOT refused: rolling a
  // contract back is a legitimate act.
  if (!from || !to || compare(from, to) >= 0) {
    return `${header}Not an ordinary forward hop — check this is intended.\n`;
  }

  if (!notes) {
    return (
      `${header}Could not read \`contract_version.py\` at the pinned ref, so what this\n` +
      `crossed is unlisted. Check it by hand before approving.\n`
    );
  }

  const crossed = entriesBetween(notes, from, to);

  // ZERO IS NOT ONE. A parse failure — a reformatted header, notes moved
  // elsewhere, an entry not yet written — used to print "One contract adopted"
  // above an empty code fence: the state most needing a human eye wearing the
  // most reassuring sentence.
  if (crossed.length === 0) {
    return (
      `${header}⚠️ **No contract entries matched**, though the file was read. The notes may\n` +
      `have been reformatted or moved, so what this crossed is unlisted. Check it by\n` +
      `hand before approving.\n`
    );
  }

  if (crossed.length === 1) {
    return `${header}One contract adopted:\n\n\`\`\`\n${crossed[0]}\n\`\`\`\n`;
  }

  return (
    `${header}⚠️ **${crossed.length} contracts adopted, not one.** Every entry below ships\n` +
    `with this pull request, whether or not its description mentions them.\n\n` +
    crossed.map((note) => `\`\`\`\n${note}\n\`\`\``).join('\n\n') +
    '\n'
  );
}

// Retried AND authenticated AND drained, because three different things can
// silence this disclosure and only one of them is a blip.
//
//  - AUTHENTICATED, and the reasoning here was wrong once in each direction.
//    First a token was added on rate-limit grounds alone; then it was removed
//    on the grounds that a repo-scoped workflow token cannot read another
//    repository's raw file — probed, and the probe answered 200
//    unauthenticated, 404 with an unusable bearer, which says only what a
//    BROKEN bearer does. What a VALID cross-repo one does is settled by the
//    `copilot-ui-pin` job in faultmaven-dashboard's ci.yml: it sends that
//    repository's own workflow token to
//    raw.githubusercontent.com/FaultMaven/faultmaven-copilot AND to
//    .../FaultMaven/faultmaven, and prints the contract it read from both. A
//    public raw read accepts any valid token; it is the INVALID one that 404s
//    instead of falling back to anonymous.
//
//    So the header is worth having — `check-copilot-ui-pin.mjs` one file over
//    says why: "raw.githubusercontent is rate-limited per IP and CI shares a
//    pool, so an unauthenticated read is a coin flip", and a 429 resets on an
//    hourly window that retrying at t+0/2/4s cannot outwait.
//
//    ‼ It is set ONLY from the environment, and only when present. A token
//    that is set but unusable fails CLOSED — 404, taken as an answer, and the
//    hop degrades to "unlisted" behind `continue-on-error`. That is the one
//    real hazard, it is why nothing here invents a token, and it is the same
//    exposure the sibling gate already carries.
//  - DRAINING. An un-consumed response body keeps the socket alive and the
//    process never exits — measured: three un-drained 503s hang `node` until
//    killed. `continue-on-error` does not rescue a hang; it only forgives a
//    non-zero exit.
//  - A DEADLINE. Without a signal, undici's 300s headersTimeout applies per
//    attempt, so a retry loop multiplies the worst-case stall.
const NOTES_ATTEMPTS = 3;
const NOTES_RETRY_MS = 2000;
const NOTES_TIMEOUT_MS = 15000;

// The statuses worth another attempt. 403 belongs here: it is one of the two
// GitHub uses for a secondary rate limit, so treating it as an answer drops
// the retry in precisely the case a retry is for.
const NOTES_RETRY_STATUSES = new Set([403, 429]);

export async function fetchNotes(pin) {
  const url = `https://raw.githubusercontent.com/${pin.repository}/${pin.ref}/faultmaven/api/contract_version.py`;
  const headers = { 'User-Agent': 'faultmaven-contract-hop' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 1; attempt <= NOTES_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(NOTES_TIMEOUT_MS),
      });
      if (response.ok) return await response.text();
      // Drain before deciding anything: an early return below would otherwise
      // leave the socket open for the life of the process.
      await response.body?.cancel();
      // Any other 4xx is an ANSWER, not a blip — a missing ref, a repository
      // rename — and retrying cannot change it.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        !NOTES_RETRY_STATUSES.has(response.status)
      ) {
        return '';
      }
    } catch {
      // Network error or deadline — worth a retry.
    }
    if (attempt < NOTES_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, NOTES_RETRY_MS));
    }
  }
  return '';
}

// `import.meta.main` is not available on every Node this repo supports, so the
// module guards on argv instead — importing it for tests must not run it.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const base = process.argv[2];
  const before = base ? pinAt(base) : null;
  const after = JSON.parse(readFileSync(path.join(REPO_ROOT, PIN_PATH), 'utf8'));
  const notes =
    before && before.contractVersion !== after.contractVersion ? await fetchNotes(after) : '';

  const output = describe({ before, after, notes });
  if (output) process.stdout.write(output);

  // `process.exitCode`, never `process.exit()`: stdout is a pipe under CI
  // (`| tee -a $GITHUB_STEP_SUMMARY`) and therefore asynchronous, so exiting
  // immediately after a write truncates it — a disclosure tool losing the
  // disclosure, silently, exactly when the note is long enough to matter.
  process.exitCode = 0;
}
