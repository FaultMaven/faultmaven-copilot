import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Manifest Permissions', () => {
  it('should not contain wildcard host permissions in the built manifest', () => {
    const manifestPath = path.resolve(__dirname, '../../../.output/chrome-mv3/manifest.json');
    
    // Only run this test if the build output exists
    if (!fs.existsSync(manifestPath)) {
      console.warn('Skipping manifest test because .output/chrome-mv3/manifest.json does not exist. Run build first.');
      return;
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // Verify host_permissions
    expect(manifest.host_permissions).toContain('https://app.faultmaven.ai/*');
    expect(manifest.host_permissions).toContain('https://api.faultmaven.ai/*');
    
    // Verify optional_host_permissions does NOT contain wildcards
    if (manifest.optional_host_permissions) {
      expect(manifest.optional_host_permissions).not.toContain('http://*/*');
      expect(manifest.optional_host_permissions).not.toContain('https://*/*');
      // Should still allow localhost for dev convenience
      expect(manifest.optional_host_permissions).toContain('http://localhost/*');
      expect(manifest.optional_host_permissions).toContain('http://127.0.0.1/*');
    }

    // Verify CSP
    expect(manifest.content_security_policy).toBeDefined();
    expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'self' http: https:");
  });
});
