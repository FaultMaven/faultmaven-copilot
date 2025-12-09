// src/entrypoints/sidepanel_manual/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../lib/api/query-client';
import SidePanelApp from '../../shared/ui/SidePanelApp'; // Path to your main React app
import '../../assets/styles/globals.css';      // Path to your global Tailwind styles
import { createLogger } from '../../lib/utils/logger';

const log = createLogger('SidePanelManual');

function mountReactApp() {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <SidePanelApp /> {/* This is your full SidePanelApp */}
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
