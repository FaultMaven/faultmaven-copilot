import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { webHostAdapter } from './web-host';
import { setHostStore } from '~/lib/host-store';
import { setHostEndpoints } from '~/lib/host-endpoints';
import '~/assets/styles/globals.css';
import './playground.css';

// What the extension's entry points do, from the web host's side: the store and
// the endpoints are properties of the CONTEXT, so they are installed once,
// before React mounts, for the plain modules that cannot read React context.
setHostStore(webHostAdapter.store);
setHostEndpoints(webHostAdapter.endpoints);

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
