import { describe, it, expect, afterEach, vi } from 'vitest';

// Stub `wxt` rather than loading it. `defineConfig` is an identity helper, but
// importing the real package pulls in esbuild, which asserts
// `new TextEncoder().encode("") instanceof Uint8Array` — false under jsdom,
// whose TextEncoder comes from another realm. Switching this file to the node
// environment does not help: the shared setup file expects a DOM. The stub keeps
// the config under test and drops only the bundler.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/**
 * The store-identity pin is OPT-IN and CHROMIUM-ONLY, and the release artifacts
 * must not carry it.
 *
 * `FM_STORE_KEY` exists so a release candidate can take the PUBLISHED extension
 * id and sign in to the public host, whose redirect allowlist admits that id and
 * nothing else (faultmaven#1169). The whole value of that affordance depends on
 * it changing nothing when it is not asked for: a `key` that leaked into a
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

/** What WXT actually passes the manifest factory, so a future gate on any of it
 *  is reachable from here rather than blocked by a too-narrow cast. */
interface ManifestEnv {
  browser: string;
  command: 'build' | 'serve';
  manifestVersion: 2 | 3;
  mode: string;
}

async function manifestWith(
  storeKey: string | undefined,
  env: Partial<ManifestEnv> = {},
): Promise<Record<string, unknown>> {
  vi.resetModules();
  vi.stubEnv('FM_STORE_KEY', storeKey);
  const config = (await import('../../../wxt.config')).default;
  const factory = config.manifest as (env: ManifestEnv) => Record<string, unknown>;
  return factory({ browser: 'chrome', command: 'build', manifestVersion: 3, mode: 'production', ...env });
}

const hasKey = (manifest: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(manifest, 'key');

// A real key shape: base64 that round-trips, so it passes validation. The value
// is arbitrary — no test here depends on which id it derives.
const VALID_KEY = Buffer.from('faultmaven-copilot-test-public-key').toString('base64');

describe('store identity is opt-in', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('omits `key` entirely when FM_STORE_KEY is unset — the release build', async () => {
    const manifest = await manifestWith(undefined);
    // Absent, not undefined-valued: a `"key": undefined` would serialise away
    // today and stop doing so the moment the spread is written differently.
    expect(hasKey(manifest)).toBe(false);
  });

  it('omits `key` when FM_STORE_KEY is set but empty or blank', async () => {
    // An exported-but-empty variable is the likely accident, and a dotenv line
    // with trailing whitespace is the next one. Emitting `key: ""` would make the
    // browser refuse to load the extension at all, which is a worse failure than
    // not pinning.
    expect(hasKey(await manifestWith(''))).toBe(false);
    expect(hasKey(await manifestWith('   '))).toBe(false);
  });

  it('carries exactly the supplied key when FM_STORE_KEY is set', async () => {
    const manifest = await manifestWith(VALID_KEY);
    expect(manifest.key).toBe(VALID_KEY);
  });

  it('trims a padded value rather than passing whitespace to the browser', async () => {
    // `Buffer.from(" MIIB…", "base64")` drops the space silently, so an untrimmed
    // value reaches Chrome as an invalid key and the extension does not load.
    const manifest = await manifestWith(`  ${VALID_KEY}\n`);
    expect(manifest.key).toBe(VALID_KEY);
  });

  it('refuses a value that is not valid base64, loudly and at build time', async () => {
    // Failing closed here beats failing at `chrome://extensions` with "Invalid
    // value for 'key'", which reads as the build being broken.
    await expect(manifestWith('not base64!!')).rejects.toThrow(/not valid base64/);
  });

  it('never puts `key` in a non-Chromium manifest, even when asked', async () => {
    // `key` is a legal Chrome key that WXT does not strip from the Firefox MV2
    // output, and release.yml publishes that zip to AMO — where an unknown
    // property is a linter finding. Measured before the gate existed:
    // `FM_STORE_KEY=… pnpm zip:firefox` wrote `"key"` into the add-on manifest.
    for (const browser of ['firefox', 'safari']) {
      const manifest = await manifestWith(VALID_KEY, { browser, manifestVersion: 2 });
      expect(hasKey(manifest), `${browser} manifest must not carry a store key`).toBe(false);
    }
  });

  it('still applies to the other Chromium targets', async () => {
    // The gate is a family, not `browser === 'chrome'`: edge and opera load the
    // same build and derive ids the same way.
    for (const browser of ['chrome', 'edge', 'opera']) {
      const manifest = await manifestWith(VALID_KEY, { browser });
      expect(manifest.key, `${browser} manifest should carry the store key`).toBe(VALID_KEY);
    }
  });

  it('changes nothing else about the manifest when the key is supplied', async () => {
    // The pin must move the identity and only the identity: a build that also
    // differed in permissions or CSP would not be the build under test.
    //
    // toStrictEqual, not toEqual: `toEqual` treats an own property whose value is
    // `undefined` as absent, so it cannot see the `key: undefined` regression the
    // first test's comment warns about — which is precisely the shape a careless
    // rewrite of the spread produces.
    const off = await manifestWith(undefined);
    const on = await manifestWith(VALID_KEY);
    const { key, ...onWithoutKey } = on;
    expect(key).toBe(VALID_KEY);
    expect(onWithoutKey).toStrictEqual(off);
  });
});
