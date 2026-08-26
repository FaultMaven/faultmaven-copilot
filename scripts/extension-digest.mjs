#!/usr/bin/env node
/**
 * Resubmission guard: detect when a change alters the SHIPPED extension.
 *
 * The Chrome Web Store reviews the packaged artifact, not the repository. Most
 * PRs here never reach it — README, docs, CI, tests are not in the build — so
 * "does this need a new version and a store upload?" is a question about the
 * artifact, never about which files a diff touched. A path allowlist would
 * answer it by proxy and fail OPEN: a new source directory nobody added to the
 * list would look like a docs change.
 *
 * So this hashes the built output and compares it to a committed baseline,
 * snapshot-test style. Changing the artifact is allowed; changing it SILENTLY
 * is not. The baseline update lands in the same PR, which is what makes the
 * change reviewable and gives `git log extension-baseline.json` a true history
 * of every package change since the last release tag.
 *
 * Two signals, deliberately separate:
 *
 *   package         — aggregate sha256 over the built tree. Answers "must this
 *                     ship as a new version before release?".
 *   manifestSurface — permissions, hosts, CSP. Answers a harder question: store
 *                     review compares these against the listing's justification
 *                     text, so a change here needs the LISTING updated too, not
 *                     just a new upload. That drift is what made the submission
 *                     doc wrong for weeks while every automated check was green.
 *
 * Only the Chrome build is tracked: it is the published target. The Firefox
 * output is built and released on GitHub but is not distributed through a store,
 * so it has no resubmission to guard.
 *
 * Usage:  node scripts/extension-digest.mjs --check   (CI; exits 1 on drift)
 *         node scripts/extension-digest.mjs --write   (accept the new artifact)
 *
 * Requires .output/chrome-mv3/ to exist — run `pnpm zip` (or `pnpm build`) first.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const BUILD_DIR = join(ROOT, '.output', 'chrome-mv3');
const BASELINE = join(ROOT, 'extension-baseline.json');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function computeDigest() {
  if (!existsSync(BUILD_DIR)) {
    console.error(`No build at ${relative(ROOT, BUILD_DIR)} — run \`pnpm zip\` first.`);
    process.exit(2);
  }
  const files = walk(BUILD_DIR);
  // Path separators are normalised so the digest is the same on any OS, and the
  // list is sorted so it does not depend on readdir order.
  const lines = files
    .map((f) => `${relative(BUILD_DIR, f).split(sep).join('/')}\0${sha256(readFileSync(f))}`)
    .sort();
  const manifest = JSON.parse(readFileSync(join(BUILD_DIR, 'manifest.json'), 'utf8'));
  const perFile = {};
  for (const line of lines) {
    const [rel, hash] = line.split('\0');
    perFile[rel] = hash;
  }
  return {
    version: manifest.version,
    manifestSurface: {
      permissions: manifest.permissions ?? [],
      host_permissions: manifest.host_permissions ?? [],
      optional_host_permissions: manifest.optional_host_permissions ?? [],
      content_security_policy: manifest.content_security_policy ?? {},
    },
    package: { fileCount: files.length, sha256: sha256(lines.join('\n')) },
    files: perFile,
  };
}

const current = computeDigest();
const mode = process.argv.includes('--write') ? 'write' : 'check';

if (mode === 'write') {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`Wrote ${relative(ROOT, BASELINE)} — package ${current.package.sha256.slice(0, 12)}, ${current.package.fileCount} files, v${current.version}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`Missing ${relative(ROOT, BASELINE)}. Create it with: pnpm extension:digest:write`);
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const surfaceChanged =
  JSON.stringify(base.manifestSurface) !== JSON.stringify(current.manifestSurface);
const packageChanged =
  base.package.sha256 !== current.package.sha256 ||
  base.package.fileCount !== current.package.fileCount;

if (!surfaceChanged && !packageChanged) {
  console.log(`Extension artifact unchanged (${current.package.sha256.slice(0, 12)}, ${current.package.fileCount} files, v${current.version}).`);
  process.exit(0);
}

console.error('Extension artifact changed.\n');
if (surfaceChanged) {
  console.error('  ‼ MANIFEST SURFACE CHANGED — permissions, hosts or CSP.');
  console.error('    Store review compares these against the listing\'s permission');
  console.error('    justifications. Update the LISTING as well as the package, or the');
  console.error('    two disagree and review flags it.\n');
  for (const k of Object.keys(current.manifestSurface)) {
    const a = JSON.stringify(base.manifestSurface?.[k]);
    const b = JSON.stringify(current.manifestSurface[k]);
    if (a !== b) console.error(`      ${k}:\n        baseline: ${a}\n        built:    ${b}`);
  }
  console.error('');
}
if (packageChanged) {
  console.error('  → PACKAGE CHANGED. This must ship as a new version and be uploaded');
  console.error('    to the Chrome Web Store; it does not reach users otherwise.');
  console.error(`      baseline: ${base.package.sha256.slice(0, 12)} (${base.package.fileCount} files, v${base.version})`);
  console.error(`      built:    ${current.package.sha256.slice(0, 12)} (${current.package.fileCount} files, v${current.version})\n`);

  // Which files, grouped by directory. Without this the aggregate says only
  // THAT something changed — useless for judging whether it matters.
  const baseFiles = base.files ?? {};
  const names = new Set([...Object.keys(baseFiles), ...Object.keys(current.files)]);
  const buckets = new Map();
  for (const n of [...names].sort()) {
    if (baseFiles[n] === current.files[n]) continue;
    const dir = n.includes('/') ? n.slice(0, n.indexOf('/')) + '/' : '(root)';
    if (!buckets.has(dir)) buckets.set(dir, []);
    buckets.get(dir).push(
      !(n in baseFiles) ? `+ ${n}` : !(n in current.files) ? `- ${n}` : `~ ${n}`,
    );
  }
  console.error('    Files that differ:');
  for (const [dir, entries] of buckets) {
    console.error(`      ${dir}  (${entries.length})`);
    for (const e of entries.slice(0, 8)) console.error(`        ${e}`);
    if (entries.length > 8) console.error(`        … ${entries.length - 8} more`);
  }
  console.error('');
}
console.error('If the change is intended, accept it in THIS PR so the artifact change is');
console.error('reviewable and recorded:\n');
console.error('    pnpm zip && pnpm extension:digest:write\n');
console.error('Expected extension-baseline.json:\n');
console.error(JSON.stringify(current, null, 2));
process.exit(1);
