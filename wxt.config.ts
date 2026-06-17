// /Users/sterlanyu/Projects/faultmaven-copilot/wxt.config.ts
import { defineConfig } from 'wxt';
import path from 'node:path';

export default defineConfig({
  srcDir: 'src',
  modules: [
    '@wxt-dev/module-react'
  ],
  vite: () => ({
    resolve: {
      alias: {
        '~': path.resolve(__dirname, 'src'),
        '~lib': path.resolve(__dirname, 'src/lib'),
      },
    },
  }),
  manifest: {
    name: "FaultMaven Copilot",
    version: "0.4.0",
    description: "AI-powered troubleshooting copilot embedded in your browser",
    icons: {
      "16": "icon/px16-square-dark.png",
      "32": "icon/px32-square-dark.png",
      "48": "icon/px48-square-dark.png",
      "96": "icon/px96-square-dark.png",
      "128": "icon/px128-square-dark.png"
    },
    permissions: [
      "storage", "sidePanel", "activeTab", "tabs", "scripting"
    ],
    host_permissions: [
      "https://app.faultmaven.ai/*",
      "https://api.faultmaven.ai/*"
    ],
    optional_host_permissions: [
      "http://localhost/*",
      "http://127.0.0.1/*",
      "http://*/*",  // Allow custom local deployments
      "https://*/*"  // Allow custom enterprise deployments
    ],
    action: {
      default_title: "Open FaultMaven Copilot",
      default_icon: {
        "16": "icon/px16-square-dark.png",
        "32": "icon/px32-square-dark.png"
      }
    },
    side_panel: {
      default_path: "sidepanel_manual.html"
    },
    // NOTE: the auth-bridge content script is declared via its WXT entrypoint
    // (src/entrypoints/auth-bridge.content.ts), not here. A previous manifest
    // block gated on process.env.VITE_DASHBOARD_URL was dead — Vite .env vars
    // populate import.meta.env, not process.env, at config-eval time — so it
    // produced nothing. Removed to avoid implying custom dashboard domains are
    // covered (they are not yet; see issue #71 for runtime registration).
    content_security_policy: {
      "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' http: https:;"
    }
  }
});