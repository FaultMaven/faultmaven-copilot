#!/usr/bin/env node
/**
 * WHAT A CONTRACT PIN BUMP CROSSED — printed, never enforced.
 *
 * `api-types-drift` asserts the pinned `contractVersion` equals the version the
 * pinned ref serves. That is the CORRECTNESS leg and it is satisfied by a hop of
 * any size: 3.5.0 → 3.7.0 passes exactly as 3.5.0 → 3.6.0 does.
 *
* It happened. A pin bump described as adopting 3.7.0's turn ordinal
 * also carried 3.6.0, in which `POST /knowledge/documents` stopped requiring
 * `platform_admin` unconditionally — an authorization change, fully green, named
 * nowhere in the pull request. A reviewer trusting the description would have
 * approved a change they were never shown, and no gate could have told them.
 *
 * So this reads the API's own `contract_version.py` and prints every entry
 * strictly above the old pin and at or below the new one. It is a DISCLOSURE
 * aid, not a rule: it never fails, because how many contracts a bump may cross
 * is a judgement, and a script answering it would make the agreement on the
 * reviewer's behalf — the same reason the breaking-change differ upstream is
 * advisory.
 *
 *     node scripts/report-contract-hop.mjs <base-ref>
 *
 * With no base ref, or when the pin did not move, it prints nothing and exits 0.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PIN = 'api-contract.pin.json';

function pinAt(ref) {
  try {
    // stderr silenced: an unreachable base is a normal outcome here (a shallow
    // clone, a first commit), and git's "fatal:" on it reads as a failure when
    // the answer is simply "nothing to compare against".
    const raw = execFileSync('git', ['show', `${ref}:${PIN}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw);
  } catch {
    return null; // no pin at that ref, or the ref is unreachable
  }
}

/** `3.7.0` → `[3, 7, 0]`, for an ordering that is numeric rather than lexical. */
function parse(version) {
  const parts = String(version ?? '').split('.').map((n) => Number.parseInt(n, 10));
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const base = process.argv[2];
if (!base) process.exit(0);

const before = pinAt(base);
const after = JSON.parse(readFileSync(PIN, 'utf8'));

// Nothing moved, or nothing to compare against.
if (!before || before.contractVersion === after.contractVersion) process.exit(0);

const from = parse(before.contractVersion);
const to = parse(after.contractVersion);
if (!from || !to || compare(from, to) >= 0) {
  // A downgrade or an unparseable version is worth saying, and still not ours
  // to refuse: rolling a contract back is a legitimate act.
  console.log(
    `### API contract pin moved\n\n` +
      `\`${before.contractVersion}\` → \`${after.contractVersion}\`. ` +
      `Not an ordinary forward hop — check this is intended.\n`,
  );
  process.exit(0);
}

let notes = '';
try {
  const response = await fetch(
    `https://raw.githubusercontent.com/${after.repository}/${after.ref}/faultmaven/api/contract_version.py`,
    { headers: { 'User-Agent': 'faultmaven-copilot-contract-hop' } },
  );
  if (response.ok) notes = await response.text();
} catch {
  /* reported below */
}

const crossed = [];
if (notes) {
  // Entries look like `# 3.6.0 — MINOR. …` and run until the next one.
  const lines = notes.split('\n');
  const starts = lines
    .map((line, i) => [i, /^#\s+(\d+\.\d+\.\d+)\s+—/.exec(line)])
    .filter(([, m]) => m);

  for (const [index, match] of starts) {
    const version = parse(match[1]);
    if (!version || compare(version, from) <= 0 || compare(version, to) > 0) continue;
    const end = starts.find(([i]) => i > index)?.[0] ?? lines.length;
    crossed.push(
      lines
        .slice(index, end)
        .map((l) => l.replace(/^#\s?/, ''))
        .join('\n')
        .trim(),
    );
  }
}

const header =
  `### API contract pin moved: \`${before.contractVersion}\` → \`${after.contractVersion}\`\n\n`;

if (!notes) {
  console.log(
    header +
      `Could not read \`contract_version.py\` at the pinned ref, so what this crossed\n` +
      `is unlisted. Check it by hand before approving.\n`,
  );
  process.exit(0);
}

if (crossed.length <= 1) {
  console.log(header + `One contract adopted. Its entry:\n\n\`\`\`\n${crossed.join('\n')}\n\`\`\`\n`);
  process.exit(0);
}

console.log(
  header +
    `⚠️ **${crossed.length} contracts adopted, not one.** Every entry below ships with\n` +
    `this pull request, whether or not its description mentions them.\n\n` +
    crossed.map((note) => `\`\`\`\n${note}\n\`\`\``).join('\n\n') +
    '\n',
);
