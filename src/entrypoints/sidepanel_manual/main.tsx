// src/entrypoints/sidepanel_manual/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../lib/api/query-client';
import { ExtensionApp } from '../../extension/ExtensionApp';
import '../../assets/styles/globals.css';      // Path to your global Tailwind styles
import '../../assets/styles/sidepanel.css';    // Sidepanel-only height/overflow chain
import { createLogger } from '../../lib/utils/logger';

const log = createLogger('SidePanelManual');

function mountReactApp() {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          {/* The host's own entry: first run, sign-in, and the session that
              CopilotPanel cannot be mounted without. The host adapter is no
              longer provided here — CopilotPanel publishes it, so the panel
              cannot be handed one host in a prop and another in context. */}
          <ExtensionApp />
        </QueryClientProvider>
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
