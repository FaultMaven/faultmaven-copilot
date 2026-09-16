import { describe, it, expect, vi } from 'vitest';
import { loadManifest } from '../support/manifest';

// See `loadManifest` for why the real `wxt` cannot be imported here, and why the
// stub has to be registered in this file rather than inside the helper.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/**
 * `tabs` stays OPTIONAL, because that is what keeps "Read your browsing history"
 * off the install dialog.
 *
 * Chrome builds that dialog from REQUIRED permissions alone, and the rule
 * `{IDS_EXTENSION_PROMPT_WARNING_HISTORY_READ, {APIPermissionID::kTab}}` means a
 * required `tabs` puts that sentence in front of every install — the most
 * alarming thing a prospective user is told about this extension, for the sake
 * of one field (`tab.url`) read at capture time.
 *
 * Moving it back to `permissions` would be silent: nothing else fails, no
 * capture test breaks, and the cost lands entirely on people deciding whether to
 * install. This is the check that makes that move loud.
 *
 * No per-browser case: `optional_permissions` is not gated on `browser` the way
 * `key` and `minimum_chrome_version` are, so asserting it for firefox as well
 * would restate the chrome assertion and could only fail alongside it. The
 * Firefox question that IS real — whether AMO accepts `tabs` as optional in the
 * MV2 zip `release.yml` publishes — cannot be answered at this level, and does
 * not arise today: that build is not published to AMO.
 */
describe('the tabs permission is optional', () => {
  it('is absent from the required permissions, so the install dialog stays quiet', async () => {
    const manifest = await loadManifest();
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('is declared as optional, so capture can still ask for it', async () => {
    // Absent from BOTH lists would also keep the dialog quiet — and would break
    // capture on every origin the extension does not already hold, with no way
    // to recover, since `permissions.request` refuses anything the manifest does
    // not declare.
    const manifest = await loadManifest();
    expect(manifest.optional_permissions).toContain('tabs');
  });

  it('keeps the permissions the extension cannot work without', async () => {
    const manifest = await loadManifest();
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'sidePanel', 'scripting', 'identity']),
    );
  });
});
