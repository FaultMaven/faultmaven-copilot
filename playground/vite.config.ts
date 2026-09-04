/**
 * Vite config for the host-independence proof.
 *
 * Deliberately standalone: it does not extend wxt.config.ts and WXT never sees
 * it, so building or running the playground cannot change the shipped
 * extension artifact (which CI hashes — scripts/extension-digest.mjs).
 *
 * Two things make the existing UI run here:
 *
 *  1. the `~` / `~lib` aliases, so shared/ui resolves exactly as it does in the
 *     extension build — the SAME files, not a copy;
 *  2. an INLINE PostCSS/Tailwind config. The root postcss.config.cjs is not
 *     reused, and the root tailwind.config.cjs is loaded but its `content` is
 *     replaced with absolute globs — so nothing here can alter the CSS the
 *     extension build emits.
 *
 * There WAS a third: `wxt/browser` aliased to a shim that answered what a web
 * host could and threw, naming the adapter member, for what it could not. Those
 * throw messages were the migration checklist. Nothing in the shared closure
 * imports `wxt/browser` any more, so the shim is gone — and the closure test
 * asserts that, which is what stops it being needed again.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// The extension's own theme tokens, verbatim. Only `content` is overridden:
// the root config's globs are relative to the CWD, and this build runs with a
// different root.
const baseTailwind = require(path.join(repoRoot, 'tailwind.config.cjs'));

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      // Longest-prefix first: Vite matches aliases in order.
      '~lib': path.resolve(repoRoot, 'src/lib'),
      '~': path.resolve(repoRoot, 'src'),
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...baseTailwind,
          content: [
            path.join(repoRoot, 'src/**/*.{js,jsx,ts,tsx}'),
            path.join(here, '**/*.{ts,tsx,html}'),
          ],
        }),
        autoprefixer(),
      ],
    },
  },
  // The extension's own public/ directory, served at the web root.
  //
  // Not a convenience: `src/shared/ui` references `/icon/*.svg` as ROOT-ABSOLUTE
  // paths in five files (ChatWindow, ChatInterface, CollapsibleNavigation,
  // AuthScreen, WelcomeScreen). Those resolve inside the extension package and
  // 404 anywhere else — as a broken <img>, with nothing thrown and nothing red.
  // Pointing publicDir here makes the proof faithful AND makes the coupling
  // explicit; the design doc lists it as a migration item.
  publicDir: path.join(repoRoot, 'public'),
  server: { port: 5174, host: true },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
});
