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
  entrypoints: {
    background: 'entrypoints/background.ts',
    'page-content.content': 'entrypoints/page-content.content.ts',
  },
  manifest: {
    name: "FaultMaven Copilot",
    version: "0.0.1",
    description: "AI-powered troubleshooting assistant embedded in your browser",
    icons: {
      "16": "icon/px16-square-dark.png",
      "32": "icon/px32-square-light.png",
      "48": "icon/px48-square-light.png", 
      "96": "icon/px96-square-light.png",
      "128": "icon/px128-square-light.png"
    },
    permissions: [
      "storage", "sidePanel", "activeTab", "tabs", "scripting"
    ],
    host_permissions: ["https://www.example.com/*"],
    action: {
      default_title: "Open FaultMaven Copilot",
      default_icon: {
        "16": "icon/px16-square-dark.png",
        "32": "icon/px32-square-light.png"
      }
    },
    side_panel: {
      default_path: "sidepanel_manual.html"
    }
  }
});