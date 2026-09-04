import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '~/assets/styles/globals.css';
import './playground.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
