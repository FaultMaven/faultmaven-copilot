import { vi } from 'vitest';

/**
 * Load the manifest WXT would build, without building it.
 *
 * Importing `wxt.config.ts` pulls in `wxt`, which loads esbuild, which asserts
 * `new TextEncoder().encode("") instanceof Uint8Array` — false under jsdom,
 * whose TextEncoder comes from another realm. Callers therefore stub the module:
 *
 *     vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));
 *
 * It cannot be stubbed from in here: `vi.mock` is hoisted to the top of the file
 * that calls it, so a mock registered in this module would not apply to the
 * importer's module graph.
 *
 * Asserting the CONFIG rather than a built manifest is deliberate. The sibling
 * tests that read `.output/chrome-mv3/manifest.json` skip when it is absent, so
 * they say nothing on a clean checkout — and on a dirty one they answer
 * according to how the last local build happened to be run rather than according
 * to the source.
 */
export interface ManifestEnv {
  browser: string;
  command: 'build' | 'serve';
  manifestVersion: 2 | 3;
  mode: string;
}

/**
 * @param env Overrides for what WXT passes the factory. The full shape is
 *   accepted so a future gate on `command` or `mode` is reachable from a test
 *   rather than blocked by a too-narrow cast.
 */
export async function loadManifest(
  env: Partial<ManifestEnv> = {},
): Promise<Record<string, unknown>> {
  vi.resetModules();
  const config = (await import('../../../wxt.config')).default;
  const factory = config.manifest as (e: ManifestEnv) => Record<string, unknown>;
  return factory({
    browser: 'chrome',
    command: 'build',
    manifestVersion: 3,
    mode: 'production',
    ...env,
  });
}
