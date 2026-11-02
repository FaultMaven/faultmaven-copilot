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
 * IT READS DATA, NOT PROSE. The API publishes its changelog as data in
 * `docs/reference/api/contract-notes.json`, and the type generator vendors that
 * file at the pinned ref. This reads the vendored copy, whose path is the
 * second argument, so there is no network and the script is the same text in
 * every repository that carries it. CI runs it after the drift gate has proved
 * the copy equal to the pinned ref's. A file that cannot be read, or that
 * matches nothing, still resolves to SAY SO rather than to reassure — see
 * `describe()`.
 *
 *     node scripts/report-contract-hop.mjs <base-ref> <vendored contract-notes.json>
 *
 * The notes path is repository-relative, like the pin. Exits 0 always. Prints
 * nothing when there is nothing to say.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchored to the REPOSITORY, not the caller's cwd. `git show <ref>:<path>` is
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
 * The entries strictly above `from` and at or below `to`, NEWEST FIRST: the
 * change most likely to break a client is the one a reviewer should meet first.
 * The API publishes them newest first already; sorting here keeps that a
 * property of this output rather than an assumption about the input.
 */
function entriesBetween(entries, from, to) {
  return entries
    .map((entry) => ({ entry, version: parseVersion(entry?.version) }))
    .filter(({ version }) => version && compare(version, from) > 0 && compare(version, to) <= 0)
    .sort((a, b) => compare(b.version, a.version))
    .map(({ entry }) => {
      const heading = `${entry.version} — ${entry.level}. ${entry.title}`;
      return entry.body ? `${heading}\n\n${entry.body}` : heading;
    });
}

/**
 * What to print, from the two pins and the parsed notes (null when the file
 * could not be read or parsed). Written so that EVERY uncertain state says it
 * is uncertain.
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

  if (!Array.isArray(notes?.entries)) {
    return (
      `${header}Could not read the vendored contract notes, so what this crossed is\n` +
      `unlisted. Check it by hand before approving.\n`
    );
  }

  const crossed = entriesBetween(notes.entries, from, to);

  // ZERO IS NOT ONE. A version with no entry — notes vendored from another ref,
  // an entry not yet written — must not print "One contract adopted" above an
  // empty code fence: the state most needing a human eye wearing the most
  // reassuring sentence.
  if (crossed.length === 0) {
    return (
      `${header}⚠️ **No contract entries matched**, though the notes were read. They may\n` +
      `come from another ref, so what this crossed is unlisted. Check it by hand\n` +
      `before approving.\n`
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

function readNotes(notesPath) {
  try {
    return JSON.parse(readFileSync(path.resolve(REPO_ROOT, notesPath), 'utf8'));
  } catch {
    return null;
  }
}

// `import.meta.main` is not available on every Node this repo supports, so the
// module guards on argv instead — importing it for tests must not run it.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [, , base, notesPath] = process.argv;
  const before = base ? pinAt(base) : null;
  const after = JSON.parse(readFileSync(path.join(REPO_ROOT, PIN_PATH), 'utf8'));
  const notes = notesPath ? readNotes(notesPath) : null;

  const output = describe({ before, after, notes });
  if (output) process.stdout.write(output);

  // `process.exitCode`, never `process.exit()`: stdout is a pipe under CI
  // (`| tee -a $GITHUB_STEP_SUMMARY`) and therefore asynchronous, so exiting
  // immediately after a write truncates it — a disclosure tool losing the
  // disclosure, silently, exactly when the note is long enough to matter.
  process.exitCode = 0;
}
