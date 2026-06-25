import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { capabilitiesManager, type BackendCapabilities } from '../../lib/capabilities';
import { authManager } from '../../lib/api';
import type { User } from '../../lib/api/types';
import { getApiUrl, getDashboardUrl, setEndpoints, validateEndpointUrl } from '../../config';
import { createLogger } from '~/lib/utils/logger';
import '../../assets/styles/globals.css';

const APP_VERSION = browser.runtime.getManifest().version;
const REPO_URL = 'https://github.com/FaultMaven/faultmaven-copilot';

const log = createLogger('Settings');

// Quick-fill presets. Each sets BOTH endpoints explicitly — the API base URL is
// no longer derived from the Dashboard URL (see docs/SELF_HOSTING.md).
const PRESETS = {
  cloud: { label: 'FaultMaven Cloud', apiBaseUrl: 'https://api.faultmaven.ai', dashboardUrl: 'https://app.faultmaven.ai' },
  localhost: { label: 'Standalone (localhost)', apiBaseUrl: 'http://localhost:8090', dashboardUrl: 'http://localhost:3333' },
  custom: { label: 'Custom / self-hosted', apiBaseUrl: '', dashboardUrl: '' },
} as const;

type PresetKey = keyof typeof PRESETS;

/** Build the host-permission origin pattern (e.g. http://192.168.1.100:8090/*) for a URL. */
function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

/**
 * Ensure the extension holds host permission for the given URLs' origins,
 * requesting it at runtime if needed. Must be called from a user gesture.
 * Without this, a cross-origin fetch from this page is subject to CORS and
 * fails even when the server is reachable.
 */
async function ensureOriginPermission(urls: string[]): Promise<boolean> {
  const origins = Array.from(
    new Set(urls.map(originPattern).filter((o): o is string => !!o))
  );
  if (origins.length === 0) return true;
  try {
    if (await browser.permissions.contains({ origins })) return true;
    return await browser.permissions.request({ origins });
  } catch (e) {
    log.warn('Host permission request failed', e);
    return false;
  }
}

/** Ping an API base URL's capabilities/health endpoint with a timeout. */
async function probeApi(apiBaseUrl: string): Promise<{ ok: boolean; error?: string }> {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const tryFetch = async (path: string): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      return await fetch(`${base}${path}`, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const res = await tryFetch('/v1/meta/capabilities');
    if (res.ok) return { ok: true };
    if (res.status === 404) {
      const health = await tryFetch('/health');
      return health.ok
        ? { ok: true }
        : { ok: false, error: `Server reachable but unhealthy (${health.status}).` };
    }
    return { ok: false, error: `Server returned ${res.status}. Check the URL and server status.` };
  } catch (error: any) {
    if (error?.name === 'AbortError') return { ok: false, error: 'Connection timed out — server not responding.' };
    return { ok: false, error: `Could not reach server: ${error?.message || 'connection failed'} (check URL / TLS / CORS).` };
  }
}

function OptionsApp() {
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('cloud');
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(PRESETS.cloud.apiBaseUrl);
  const [dashboardUrl, setDashboardUrl] = useState<string>(PRESETS.cloud.dashboardUrl);
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    loadSettings();
    authManager.getCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);

  const handleSignOut = async () => {
    try {
      await authManager.clearAuthState();
      setUser(null);
      showStatus('Signed out. Reload the side panel to sign in again.', 'info');
    } catch (error) {
      log.error('Sign out failed', error);
      showStatus('✗ Sign out failed', 'error');
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [api, dash] = await Promise.all([getApiUrl(), getDashboardUrl()]);
      setApiBaseUrl(api);
      setDashboardUrl(dash);

      const matched = (Object.keys(PRESETS) as PresetKey[]).find(
        key => PRESETS[key].apiBaseUrl === api && PRESETS[key].dashboardUrl === dash
      );
      setSelectedPreset(matched || 'custom');

      try {
        setCapabilities(await capabilitiesManager.fetch(api));
      } catch (error) {
        log.warn('Failed to load capabilities', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const showStatus = (text: string, type: 'success' | 'error' | 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 6000);
  };

  const handlePresetChange = (preset: PresetKey) => {
    setSelectedPreset(preset);
    // Apply the preset's endpoints unconditionally. For 'custom' both values are
    // empty strings, so selecting it CLEARS the fields (no stale cloud/localhost
    // values left behind) and the placeholders prompt the user for their own.
    setApiBaseUrl(PRESETS[preset].apiBaseUrl);
    setDashboardUrl(PRESETS[preset].dashboardUrl);
    setCapabilities(null);
    setStatusMessage(null);
  };

  const handleTest = async () => {
    const api = apiBaseUrl.trim();
    const formatError = validateEndpointUrl(api);
    if (formatError) {
      showStatus(`✗ API base URL: ${formatError}`, 'error');
      return;
    }
    setTesting(true);
    showStatus('Testing connection…', 'info');
    try {
      // Grant host permission first, else the cross-origin probe hits CORS.
      const granted = await ensureOriginPermission([api]);
      if (!granted) {
        showStatus('✗ Permission to access the configured server was denied.', 'error');
        return;
      }
      const result = await probeApi(api);
      if (!result.ok) {
        showStatus(`✗ ${result.error}`, 'error');
        setCapabilities(null);
        return;
      }
      try {
        const caps = await capabilitiesManager.fetch(api);
        setCapabilities(caps);
        showStatus(`✓ Connected to ${caps.deploymentMode} backend`, 'success');
      } catch {
        setCapabilities(null);
        showStatus('✓ Connection successful', 'success');
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const api = apiBaseUrl.trim();
    const dash = dashboardUrl.trim();

    // Validate both before doing anything (non-localhost must be https).
    const apiError = validateEndpointUrl(api);
    if (apiError) {
      showStatus(`✗ API base URL: ${apiError}`, 'error');
      return;
    }
    const dashError = dash ? validateEndpointUrl(dash) : null;
    if (dashError) {
      showStatus(`✗ Dashboard URL: ${dashError}`, 'error');
      return;
    }

    setSaving(true);
    showStatus('Requesting access and validating…', 'info');
    try {
      // Request host permission for the configured origin(s) at runtime. Cloud
      // origins are already in host_permissions and resolve without a prompt.
      const granted = await ensureOriginPermission(dash ? [api, dash] : [api]);
      if (!granted) {
        showStatus('✗ Permission to access the configured server was denied.', 'error');
        setSaving(false);
        return;
      }

      // Validate connectivity before persisting (no silent dead copilot).
      const probe = await probeApi(api);
      if (!probe.ok) {
        showStatus(`✗ ${probe.error}`, 'error');
        setSaving(false);
        return;
      }

      await setEndpoints({ apiBaseUrl: api, dashboardUrl: dash || undefined });
      await browser.storage.local.set({ hasCompletedFirstRun: true });
      showStatus('✓ Settings saved. Reload the extension to apply.', 'success');

      try {
        setCapabilities(await capabilitiesManager.fetch(api));
      } catch (error) {
        log.warn('Failed to load capabilities after save', error);
        setCapabilities(null);
      }
    } catch (error: any) {
      log.error('Save failed', error);
      showStatus(`✗ ${error?.message || 'Failed to save settings'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-fm-canvas">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-fm-accent mb-4"></div>
          <p className="text-fm-text-tertiary">Loading settings...</p>
        </div>
      </div>
    );
  }

  const isCustom = selectedPreset === 'custom';
  let connectionHost = '';
  try {
    connectionHost = apiBaseUrl ? new URL(apiBaseUrl).host : '';
  } catch {
    connectionHost = '';
  }

  return (
    <div className="min-h-screen bg-fm-canvas py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <img src="/icon/design-transparent.svg" alt="FaultMaven" className="h-10 w-auto" />
            <h1 className="text-3xl font-bold text-fm-text-primary">FaultMaven Settings</h1>
          </div>
          <p className="text-fm-text-tertiary">Configure your FaultMaven Copilot extension</p>
          <p className="text-xs text-fm-text-secondary mt-1">Close this tab to return to the sidepanel</p>
        </div>

        {/* Settings Form */}
        <div className="bg-fm-surface rounded-lg border border-fm-border p-6 mb-4">
          {/* Preset Selection */}
          <div className="mb-6">
            <label htmlFor="preset-selector" className="block text-sm font-medium text-fm-text-primary mb-2">
              Server Type
            </label>
            <select
              id="preset-selector"
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
              className="w-full px-3 py-2 border border-fm-border rounded-lg focus:outline-none focus:ring-2 focus:ring-fm-accent focus:border-transparent bg-fm-base text-fm-text-primary"
            >
              <option value="cloud">FaultMaven Cloud</option>
              <option value="localhost">Standalone — FaultMaven on this machine</option>
              <option value="custom">Custom / self-hosted (LAN or remote)</option>
            </select>
            <p className="mt-1 text-xs text-fm-text-secondary">
              The API base URL is what the copilot talks to. The Dashboard URL is where browser sign-in (OAuth) and the “open in Dashboard” links (reports, runbooks) go.
              {' '}<strong className="text-fm-text-primary">Standalone</strong> means FaultMaven running on <em>this</em> computer. For a server elsewhere on your network, choose <strong className="text-fm-text-primary">Custom</strong> and enter its address.
            </p>
          </div>

          {/* API Base URL */}
          <div className="mb-6">
            <label htmlFor="api-base-url" className="block text-sm font-medium text-fm-text-primary mb-2">
              API base URL <span className="text-fm-critical ml-1">*</span>
            </label>
            <input
              type="text"
              id="api-base-url"
              value={apiBaseUrl}
              onChange={(e) => {
                setApiBaseUrl(e.target.value);
                if (!isCustom) setSelectedPreset('custom');
                setCapabilities(null);
                setStatusMessage(null);
              }}
              placeholder="e.g., http://192.168.1.100:8090  (your server's IP and API port)"
              disabled={!isCustom}
              className="w-full px-3 py-2 border border-fm-border rounded-lg focus:outline-none focus:ring-2 focus:ring-fm-accent focus:border-transparent bg-fm-base text-fm-text-primary disabled:bg-fm-surface disabled:text-fm-text-tertiary font-mono text-sm"
            />
            <p className="mt-1 text-xs text-fm-text-tertiary">
              Any host — a LAN IP or a domain. <strong className="text-fm-text-primary">http</strong> needs no certificate (e.g. <code className="bg-fm-code-bg px-1 rounded text-fm-code font-mono border border-fm-code-border">http://192.168.1.100:8090</code>). <strong className="text-fm-text-primary">https</strong> works only if the server presents a TLS certificate your browser already trusts — a CA cert for a domain, or a self-signed cert you&apos;ve imported (self-signed certs are otherwise rejected). On <strong className="text-fm-text-primary">Save</strong> you&apos;ll approve a one-time access prompt. Prefer https on untrusted networks — over http, tokens travel in cleartext.
            </p>
          </div>

          {/* Dashboard URL */}
          <div className="mb-6">
            <label htmlFor="dashboard-url" className="block text-sm font-medium text-fm-text-primary mb-2">
              Dashboard URL <span className="text-fm-text-tertiary ml-1 font-normal">(sign-in &amp; Dashboard links)</span>
            </label>
            <input
              type="text"
              id="dashboard-url"
              value={dashboardUrl}
              onChange={(e) => {
                setDashboardUrl(e.target.value);
                if (!isCustom) setSelectedPreset('custom');
                setStatusMessage(null);
              }}
              placeholder="e.g., http://192.168.1.100:3333  (same server, dashboard port)"
              disabled={!isCustom}
              className="w-full px-3 py-2 border border-fm-border rounded-lg focus:outline-none focus:ring-2 focus:ring-fm-accent focus:border-transparent bg-fm-base text-fm-text-primary disabled:bg-fm-surface disabled:text-fm-text-tertiary font-mono text-sm"
            />
          </div>

          {/* Connection status (populated on load + after Test/Save) */}
          {capabilities && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-fm-text-primary mb-2">
                Connection
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-fm-success-bg text-fm-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-fm-success" /> Connected
                </span>
                {connectionHost && (
                  <span className="text-sm text-fm-text-secondary font-mono">{connectionHost}</span>
                )}
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  capabilities.deploymentMode === 'self-hosted'
                    ? 'bg-fm-success-bg text-fm-success'
                    : 'bg-fm-accent-soft text-fm-accent'
                }`}>
                  {capabilities.deploymentMode === 'self-hosted' ? 'Self-Hosted' : 'Cloud'}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col xs:flex-row gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-fm-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 bg-fm-elevated text-fm-text-primary border border-fm-border rounded-lg hover:bg-fm-border-strong disabled:opacity-50 font-medium"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${
              statusMessage.type === 'success'
                ? 'bg-fm-success-bg text-fm-success border border-fm-success-border'
                : statusMessage.type === 'error'
                ? 'bg-fm-critical-bg text-fm-critical border border-fm-critical-border'
                : 'bg-fm-accent-soft text-fm-accent border border-fm-accent-border'
            }`}>
              {statusMessage.text}
            </div>
          )}
        </div>

        {/* Account */}
        {user && (
          <div className="bg-fm-surface rounded-lg border border-fm-border p-6 mb-4">
            <h2 className="text-lg font-semibold text-fm-text-primary mb-3">Account</h2>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-fm-text-primary">
                  Signed in as <strong>{user.display_name || user.username || user.email || 'user'}</strong>
                </p>
                {user.email && (user.display_name || user.username) && (
                  <p className="text-xs text-fm-text-tertiary truncate">{user.email}</p>
                )}
                {user.roles && user.roles.length > 0 && (
                  <p className="text-xs text-fm-text-tertiary mt-0.5">Roles: {user.roles.join(', ')}</p>
                )}
              </div>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 flex-shrink-0 bg-fm-elevated text-fm-text-primary border border-fm-border rounded-lg hover:bg-fm-border-strong font-medium text-sm"
              >
                Sign out
              </button>
            </div>
          </div>
        )}

        {/* Help Section */}
        <div className="bg-fm-surface rounded-lg border border-fm-border p-6">
          <h2 className="text-lg font-semibold text-fm-text-primary mb-3">Configuration Guide</h2>
          <div className="space-y-3 text-sm text-fm-text-tertiary">
            <div>
              <strong className="font-semibold text-fm-text-primary">FaultMaven Cloud:</strong>
              <p className="mt-1">API <code className="bg-fm-code-bg px-1 py-0.5 rounded text-fm-code font-mono border border-fm-code-border">https://api.faultmaven.ai</code>, Dashboard <code className="bg-fm-code-bg px-1 py-0.5 rounded text-fm-code font-mono border border-fm-code-border">https://app.faultmaven.ai</code> (default)</p>
            </div>
            <div>
              <strong className="font-semibold text-fm-text-primary">Standalone (this machine):</strong>
              <p className="mt-1">FaultMaven running on your own computer (<code className="bg-fm-code-bg px-1 py-0.5 rounded text-fm-code font-mono border border-fm-code-border">docker compose up</code>) — API <code className="bg-fm-code-bg px-1 py-0.5 rounded text-fm-code font-mono border border-fm-code-border">http://localhost:8090</code>, Dashboard <code className="bg-fm-code-bg px-1 py-0.5 rounded text-fm-code font-mono border border-fm-code-border">http://localhost:3333</code> (matches <code className="bg-fm-code-bg px-1 py-0.5 rounded text-fm-code font-mono border border-fm-code-border">faultmaven.sh health</code>). For a server on another machine, use <strong className="text-fm-text-primary">Custom</strong> instead.</p>
            </div>
            <div>
              <strong className="font-semibold text-fm-text-primary">Custom / self-hosted:</strong>
              <p className="mt-1">Set your own API base URL — http or https, any host (LAN IP or domain). Grant access when prompted on Save; no reverse proxy or backend CORS setup needed. Set the Dashboard URL too if you use browser (OAuth) sign-in or the “open in Dashboard” links. See the self-hosting guide.</p>
            </div>
            <div className="pt-2 border-t border-fm-border">
              <p>Click <strong className="text-fm-text-primary">&ldquo;Test Connection&rdquo;</strong> before saving.</p>
              <p>Reload the extension after changing settings.</p>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="bg-fm-surface rounded-lg border border-fm-border p-6 mt-4">
          <h2 className="text-lg font-semibold text-fm-text-primary mb-3">About</h2>
          <p className="text-sm text-fm-text-secondary mb-3">
            FaultMaven Copilot <span className="text-fm-text-tertiary font-mono">v{APP_VERSION}</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href="https://faultmaven.ai" target="_blank" rel="noopener noreferrer" className="text-fm-accent hover:underline">Website</a>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-fm-accent hover:underline">GitHub</a>
            <a href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer" className="text-fm-accent hover:underline">Privacy Policy</a>
            <a href={`${REPO_URL}/blob/main/docs/SELF_HOSTING.md`} target="_blank" rel="noopener noreferrer" className="text-fm-accent hover:underline">Self-hosting guide</a>
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className="text-fm-accent hover:underline">Report an issue</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mount the app
const root = document.getElementById('app');
if (root) {
  ReactDOM.createRoot(root).render(<OptionsApp />);
}
