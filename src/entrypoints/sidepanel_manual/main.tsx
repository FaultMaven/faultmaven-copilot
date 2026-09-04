// src/entrypoints/sidepanel_manual/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ExtensionApp } from '../../extension/ExtensionApp';
import { installExtensionHostContext } from '../../extension/host/install';
import '@faultmaven/copilot-ui/styles/globals.css';  // The shared UI's theme + type scale
import '../../assets/styles/sidepanel.css';    // Sidepanel-only height/overflow chain
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('SidePanelManual');

// Before React mounts, not from inside a component. The store's first read is
// the app-state bootstrap that runs in ExtensionApp's very first effect, and an
// effect that installed it would be racing the effect that uses it.
installExtensionHostContext();

function mountReactApp() {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        {/* The host's own entry: first run, sign-in, and the session that
            CopilotPanel cannot be mounted without. Neither the host adapter nor
            the query client is provided here — the panel publishes both, so it
            cannot be handed one in a prop and another in context, and nothing
            this entry renders above the panel uses a query of its own. */}
        <ExtensionApp />
      </React.StrictMode>
    );
    log.info('React app mounted successfully.');
  } else {
    log.error('Fatal Error: Root element #root not found in sidepanel_manual/index.html.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountReactApp);
} else {
  mountReactApp();
}
