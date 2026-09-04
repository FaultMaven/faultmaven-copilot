#!/usr/bin/env node
/**
 * Serve the package's assets from this host's web root.
 *
 * `@faultmaven/copilot-ui` references its logo as `/icon/*.svg` — a ROOT-ABSOLUTE
 * path, because that is the only form that works identically in an extension
 * page and on a web page. It resolves against whatever the HOST serves at `/`,
 * so the package publishes the files and each host puts them there. The
 * Dashboard will do the same thing with its own static directory.
 *
 * Copied rather than committed twice: the copies under public/ are gitignored,
 * so there is exactly ONE version of each file in the repository. A copy that
 * drifted from its source is the failure this whole extraction exists to
 * remove, and a second committed copy is how that starts.
 *
 * A missing file here is a broken <img> and nothing else — no error, no red
 * test — so `package-assets.test.ts` asserts every referenced icon exists in
 * the package, and the artifact digest catches one that fails to reach the zip.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const from = path.join(repoRoot, 'packages/copilot-ui/public');
const to = path.join(repoRoot, 'public');

if (!existsSync(from)) {
  console.error(`No package assets at ${from}`);
  process.exit(1);
}

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

const icons = await readdir(path.join(from, 'icon'));
console.log(`Synced ${icons.length} package asset(s) into public/: ${icons.join(', ')}`);
