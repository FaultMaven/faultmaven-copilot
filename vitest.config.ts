import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
    // A git worktree checked out under the repo (`git worktree add
    // .worktrees/<name>`) is a second, usually stale copy of this whole suite.
    // Vitest globs the filesystem and does not read .gitignore, so without this
    // a local run silently collects both copies and a green result can be
    // coming from the wrong tree. CI checks out one tree and was never
    // affected, which is why it went unnoticed.
    //
    // Spread configDefaults rather than listing patterns outright: assigning
    // `exclude` replaces vitest's list wholesale. The previous value did that,
    // and its bare `node_modules/**` matched only the root — a worktree's own
    // nested node_modules was still being walked.
    exclude: [...configDefaults.exclude, 'e2e/**', '**/.worktrees/**'],
  },
  resolve: {
    // None. The suite resolves the shared UI as the hosts do — through the
    // package — so a test cannot pass against files a host would not load.
    alias: {},
  },
});
