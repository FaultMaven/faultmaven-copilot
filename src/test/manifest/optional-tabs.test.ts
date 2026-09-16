import { describe, it, expect, vi } from 'vitest';

// Stub `wxt` rather than loading it: importing the real package pulls in
// esbuild, which asserts `new TextEncoder().encode("") instanceof Uint8Array` —
// false under jsdom, whose TextEncoder comes from another realm.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/**
 * `tabs` stays OPTIONAL, because that is what keeps "Read your browsing history"
 * off the install dialog.
 *
 * Chrome builds that dialog from REQUIRED permissions alone, and the rule
 * `{IDS_EXTENSION_PROMPT_WARNING_HISTORY_READ, {APIPermissionID::kTab}}` means a
 * required `tabs` puts that sentence in front of every install — the single most
 * alarming thing a new user is told about this extension, for the sake of one
 * field (`tab.url`) read at capture time.
 *
 * Moving it back to `permissions` would be silent: nothing else fails, no test
 * about capture breaks, and the cost lands entirely on people deciding whether
 * to install. This is the check that makes that move loud.
 */
async function manifestFor(browser: string): Promise<Record<string, unknown>> {
  vi.resetModules();
  const config = (await import('../../../wxt.config')).default;
  const factory = config.manifest as (env: {
    browser: string;
    command: 'build' | 'serve';
    manifestVersion: 2 | 3;
    mode: string;
  }) => Record<string, unknown>;
  return factory({ browser, command: 'build', manifestVersion: 3, mode: 'production' });
}

describe('the tabs permission is optional', () => {
  it('is absent from the required permissions, so the install dialog stays quiet', async () => {
    const manifest = await manifestFor('chrome');
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('is declared as optional, so capture can still ask for it', async () => {
    // Absent from BOTH lists would also keep the dialog quiet — and would break
    // capture on every origin the extension does not already hold, with no way
    // to recover, since `permissions.request` refuses anything the manifest does
    // not declare.
    const manifest = await manifestFor('chrome');
    expect(manifest.optional_permissions).toContain('tabs');
  });

  it('keeps the permissions the extension cannot work without', async () => {
    const manifest = await manifestFor('chrome');
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'sidePanel', 'scripting', 'identity']),
    );
  });

  it('holds on Firefox too, where the same dialog is shown at install', async () => {
    const manifest = await manifestFor('firefox');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.optional_permissions).toContain('tabs');
  });
});
