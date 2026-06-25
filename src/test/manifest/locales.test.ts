import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Manifest Locales', () => {
  it('should have default_locale set to en and use localized strings', () => {
    const manifestPath = path.resolve(__dirname, '../../../.output/chrome-mv3/manifest.json');
    
    // Only run this test if the build output exists
    if (!fs.existsSync(manifestPath)) {
      console.warn('Skipping manifest test because .output/chrome-mv3/manifest.json does not exist. Run build first.');
      return;
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    expect(manifest.default_locale).toBe('en');
    expect(manifest.name).toBe('__MSG_appName__');
    expect(manifest.description).toBe('__MSG_appDescription__');
  });

  it('should output the messages.json to the locales directory', () => {
    const localesPath = path.resolve(__dirname, '../../../.output/chrome-mv3/_locales/en/messages.json');
    
    if (!fs.existsSync(localesPath)) {
      console.warn('Skipping locales test because .output/chrome-mv3/_locales/en/messages.json does not exist. Run build first.');
      return;
    }

    const messagesContent = fs.readFileSync(localesPath, 'utf8');
    const messages = JSON.parse(messagesContent);

    expect(messages.appName.message).toBeDefined();
    expect(messages.appDescription.message).toBeDefined();
  });
});
