import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PanelProof, readInitialCaseFromQuery, readChromeFromQuery } from './PanelProof';
import { webHostAdapter } from './web-host';
import { installStubBackend, stubTransport } from './stub-backend';
import {
  setHostStore,
  setHostEndpoints,
  setApiTransport,
  clearPersistedSession,
} from '@faultmaven/copilot-ui';
import '@faultmaven/copilot-ui/styles/globals.css';
import './playground.css';

// What the extension's entry points do, from the web host's side: the store and
// the endpoints are properties of the CONTEXT, so they are installed once,
// before React mounts, for the plain modules that cannot read React context.
setHostStore(webHostAdapter.store);
setHostEndpoints(webHostAdapter.endpoints);

/**
 * `?case=new` and `?case=<id>` mount the WHOLE panel, on what the host asked
 * for. Without a query string the page stays the transcript proof, which needs
 * no backend at all.
 */
const initialCase = readInitialCaseFromQuery(window.location.search);

if (initialCase) {
  installStubBackend();
  // The transport is session-scoped, so it is installed with the session — and
  // its `clearSession` delegates to the package rather than restating which
  // keys a session occupies.
  setApiTransport(
    stubTransport(
      () => webHostAdapter.session.accessToken(),
      () => clearPersistedSession(),
    ),
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {initialCase ? (
        <PanelProof initialCase={initialCase} chrome={readChromeFromQuery(window.location.search)} />
      ) : (
        <App />
      )}
    </React.StrictMode>,
  );
}
