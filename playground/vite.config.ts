/**
 * Vite config for the host-independence proof.
 *
 * Deliberately standalone: it does not extend wxt.config.ts and WXT never sees
 * it, so building or running the playground cannot change the shipped
 * extension artifact (which CI hashes — scripts/extension-digest.mjs).
 *
 * Two things make the shared UI run here:
 *
 *  1. NOTHING. It is a dependency — `@faultmaven/copilot-ui`, resolved by name,
 *     the same way the Dashboard will resolve it. There is no alias, so this
 *     proof cannot pass by reaching into files a real consumer could not.
 *  2. an INLINE PostCSS/Tailwind config that consumes the package's own preset.
 *     The root postcss.config.cjs is not reused and the root tailwind.config.cjs
 *     is not loaded, so nothing here can alter the CSS the extension emits —
 *     and the theme both hosts render is the package's, not a copy of it.
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

// The PACKAGE's theme, which is where the theme lives. Consumed as a preset,
// exactly as the extension's config consumes it and as the Dashboard's will —
// so a token that resolves in one host resolves in all of them or in none.
const copilotUiPreset = require('@faultmaven/copilot-ui/tailwind-preset.cjs');

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      // Deliberately empty. The proof consumes the shared UI as a PACKAGE, by
      // name, exactly as the Dashboard will — not through a source alias that
      // only exists inside this repository.
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          presets: [copilotUiPreset],
          // Only this host's own files. The package globs its own in the preset.
          content: [path.join(here, '**/*.{ts,tsx,html}')],
        }),
        autoprefixer(),
      ],
    },
  },
  // The PACKAGE's own public/ directory, served at the web root.
  //
  // Not a convenience: the shared UI references `/icon/*.svg` as ROOT-ABSOLUTE
  // paths, which resolve against whatever the host serves at `/` and 404
  // anywhere else — as a broken <img>, with nothing thrown and nothing red. The
  // package ships those files, so a host serves the package's directory. This
  // is the whole of what the Dashboard has to do about assets.
  publicDir: path.join(repoRoot, 'packages/copilot-ui/public'),
  server: { port: 5174, host: true },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
});
