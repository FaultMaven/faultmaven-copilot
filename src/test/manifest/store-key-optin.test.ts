import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub `wxt` rather than loading it. `defineConfig` is an identity helper, but
// importing the real package pulls in esbuild, which asserts
// `new TextEncoder().encode("") instanceof Uint8Array` — false under jsdom,
// whose TextEncoder comes from another realm. Switching this file to the node
// environment does not help: the shared setup file expects a DOM. The stub keeps
// the config under test and drops only the bundler.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/**
 * The store-identity pin is OPT-IN, and the release artifact must not carry it.
 *
 * `FM_STORE_KEY` exists so a release candidate can take the PUBLISHED extension
 * id and sign in to the public host, whose redirect allowlist admits that id and
 * nothing else (faultmaven#1169). The whole value of that affordance depends on
 * it changing nothing when it is not asked for: a `key` that leaked into the
 * shipped manifest would hand every unpacked build the published identity, and
 * would change the very artifact the testing is supposed to validate.
 *
 * This asserts the CONFIG rather than a built manifest on disk. The sibling
 * manifest tests read `.output/chrome-mv3/manifest.json` and skip when it is
 * absent, so they say nothing on a clean checkout — and here they would say the
 * wrong thing on a dirty one, since whether the file has a `key` depends on how
 * the last local build happened to be run. Evaluating the manifest factory makes
 * the answer depend on the source alone.
 */
async function manifestWith(storeKey: string | undefined): Promise<Record<string, unknown>> {
  vi.resetModules();
  if (storeKey === undefined) {
    delete process.env.FM_STORE_KEY;
  } else {
    process.env.FM_STORE_KEY = storeKey;
  }
  const config = (await import('../../../wxt.config')).default;
  const factory = config.manifest as (env: { browser: string }) => Record<string, unknown>;
  return factory({ browser: 'chrome' });
}

describe('store identity is opt-in', () => {
  const saved = process.env.FM_STORE_KEY;

  beforeEach(() => {
    delete process.env.FM_STORE_KEY;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.FM_STORE_KEY;
    else process.env.FM_STORE_KEY = saved;
  });

  it('omits `key` entirely when FM_STORE_KEY is unset — the release build', async () => {
    const manifest = await manifestWith(undefined);
    // Absent, not undefined-valued: a `"key": undefined` would serialise away
    // today and stop doing so the moment the spread is written differently.
    expect(Object.prototype.hasOwnProperty.call(manifest, 'key')).toBe(false);
  });

  it('omits `key` when FM_STORE_KEY is set but empty', async () => {
    // An exported-but-empty variable is the likely accident. Emitting `key: ""`
    // would make the browser refuse to load the extension at all, which is a
    // worse failure than not pinning.
    const manifest = await manifestWith('');
    expect(Object.prototype.hasOwnProperty.call(manifest, 'key')).toBe(false);
  });

  it('carries exactly the supplied key when FM_STORE_KEY is set', async () => {
    const manifest = await manifestWith('TEST-PUBLIC-KEY');
    expect(manifest.key).toBe('TEST-PUBLIC-KEY');
  });

  it('changes nothing else about the manifest when the key is supplied', async () => {
    // The pin must move the identity and only the identity: a build that also
    // differed in permissions or CSP would not be the build under test.
    const off = await manifestWith(undefined);
    const on = await manifestWith('TEST-PUBLIC-KEY');
    const { key, ...onWithoutKey } = on;
    expect(key).toBe('TEST-PUBLIC-KEY');
    expect(onWithoutKey).toEqual(off);
  });
});
