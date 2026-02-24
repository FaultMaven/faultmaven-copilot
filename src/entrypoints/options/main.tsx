import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { capabilitiesManager, type BackendCapabilities } from '../../lib/capabilities';
import '../../assets/styles/globals.css';

// Preset Dashboard endpoints for quick selection
// Users configure Dashboard URL (where they log in), not API URL
const PRESET_ENDPOINTS = {
  production: 'https://app.faultmaven.ai',
  localhost: 'http://127.0.0.1:3333',
  custom: ''
} as const;

type PresetKey = keyof typeof PRESET_ENDPOINTS;

function OptionsApp() {
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('production');
  const [apiEndpoint, setApiEndpoint] = useState('https://app.faultmaven.ai');
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const stored = await browser.storage.local.get(['apiEndpoint']);
      const dashboardUrl = stored.apiEndpoint || 'https://app.faultmaven.ai';
      setApiEndpoint(dashboardUrl);

      // Detect which preset matches the stored endpoint
      const matchedPreset = (Object.keys(PRESET_ENDPOINTS) as PresetKey[]).find(
        key => PRESET_ENDPOINTS[key] === dashboardUrl
      );
      setSelectedPreset(matchedPreset || 'custom');

      // Try to load capabilities from API backend
      // Note: Storage contains Dashboard URL, derive API URL for capabilities
      try {
        const apiUrl = deriveApiUrl(dashboardUrl);
        const caps = await capabilitiesManager.fetch(apiUrl);
        setCapabilities(caps);
      } catch (error) {
        console.warn('Failed to load capabilities:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Derives API URL from Dashboard URL for validation
   *
   * Since we store Dashboard URL but need to validate the API backend,
   * we must derive the API URL using the same logic as config.ts:getApiUrl()
   */
  const deriveApiUrl = (dashboardUrl: string): string => {
    // Local deployment: Replace Dashboard port (3333) with API port (8090)
    // Supports localhost and 127.0.0.1 (port 3333 auto-detection as fallback)
    if (dashboardUrl.includes('localhost') ||
        dashboardUrl.includes('127.0.0.1') ||
        dashboardUrl.includes(':3333')) {
      return dashboardUrl.replace(':3333', ':8090');
    }

    // Cloud deployment: Replace app subdomain with api subdomain
    // https://app.faultmaven.ai → https://api.faultmaven.ai
    return dashboardUrl.replace('app.', 'api.');
  };

  /**
   * Validates Dashboard URL by checking the API backend
   *
   * Architecture: Users configure Dashboard URL (where they login), but we validate
   * by checking the API backend since that's what actually serves the capabilities endpoint.
   *
   * Validation steps:
   * 1. Derive API URL from Dashboard URL
   * 2. Check API capabilities endpoint (validates full stack)
   * 3. Fallback to basic health check if capabilities not available
   */
  const validateEndpoint = async (dashboardUrl: string): Promise<{ success: boolean; error?: string }> => {
    if (!dashboardUrl || !dashboardUrl.trim()) {
      return { success: false, error: 'Please enter a Dashboard URL' };
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(dashboardUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'Invalid protocol. Use http:// or https://' };
      }

      // Warn about insecure HTTP for non-localhost
      if (parsedUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsedUrl.hostname)) {
        console.warn('[Settings] Insecure HTTP endpoint detected:', dashboardUrl);
      }
    } catch (error) {
      return { success: false, error: 'Invalid URL format' };
    }

    // Derive API URL from Dashboard URL for validation
    const apiUrl = deriveApiUrl(dashboardUrl);

    // Perform health check via API Gateway with timeout
    // Try capabilities endpoint first (validates full stack), fall back to simple health check
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      // Try capabilities endpoint (validates API Gateway + backend)
      const capabilitiesUrl = `${apiUrl.replace(/\/$/, '')}/v1/meta/capabilities`;
      const response = await fetch(capabilitiesUrl, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // Successfully reached API Gateway and backend
        return { success: true };
      } else if (response.status === 404) {
        // Capabilities endpoint not found - try fallback health check
        return await validateEndpointFallback(apiUrl);
      } else {
        return {
          success: false,
          error: `Server returned ${response.status}. Check URL and server status.`
        };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Connection timeout. Server not responding.' };
      }
      return {
        success: false,
        error: `Connection failed: ${error.message || 'Unable to reach server'}`
      };
    }
  };

  /**
   * Fallback health check using generic health endpoint
   * Used when capabilities endpoint is not available (older backend versions)
   */
  const validateEndpointFallback = async (apiUrl: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Try generic health endpoint on API server
      const healthUrl = `${apiUrl.replace(/\/$/, '')}/health`;
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return { success: true };
      } else {
        return {
          success: false,
          error: `API Gateway unreachable (${response.status}). Verify URL is correct.`
        };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Connection timeout. Server not responding.' };
      }
      return {
        success: false,
        error: `Unable to reach API Gateway: ${error.message || 'Connection failed'}`
      };
    }
  };

  const handleSave = async () => {
    const trimmedUrl = apiEndpoint.trim();

    if (!trimmedUrl) {
      showStatus('Please enter an API endpoint', 'error');
      return;
    }

    setSaving(true);
    showStatus('Validating connection...', 'info');

    try {
      // VALIDATION REQUIREMENT: Test connection before saving
      const validation = await validateEndpoint(trimmedUrl);

      if (!validation.success) {
        showStatus(`Connection failed: ${validation.error}`, 'error');
        setSaving(false);
        return;
      }

      // Connection successful - save to storage
      await browser.storage.local.set({ apiEndpoint: trimmedUrl });

      // Also mark first run as completed (if not already done)
      await browser.storage.local.set({ hasCompletedFirstRun: true });

      showStatus('✓ Settings saved! Please reload the extension.', 'success');

      // Try to load capabilities from new endpoint
      // Note: capabilitiesManager.fetch expects API URL, not Dashboard URL
      try {
        const apiUrl = deriveApiUrl(trimmedUrl);
        const caps = await capabilitiesManager.fetch(apiUrl);
        setCapabilities(caps);
      } catch (error) {
        console.warn('Failed to load capabilities after save:', error);
        setCapabilities(null);
      }
    } catch (error) {
      console.error('[Settings] Save failed:', error);
      showStatus('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const trimmedUrl = apiEndpoint.trim();

    if (!trimmedUrl) {
      showStatus('Please enter an API endpoint', 'error');
      return;
    }

    setTesting(true);
    showStatus('Testing connection...', 'info');

    try {
      const validation = await validateEndpoint(trimmedUrl);

      if (validation.success) {
        // Also try to fetch capabilities for detailed info
        // Note: capabilitiesManager.fetch expects API URL, not Dashboard URL
        try {
          const apiUrl = deriveApiUrl(trimmedUrl);
          const caps = await capabilitiesManager.fetch(apiUrl);
          setCapabilities(caps);
          showStatus(
            `✓ Connected successfully to ${caps.deploymentMode} backend`,
            'success'
          );
        } catch (error) {
          // Health check passed but capabilities fetch failed - still valid endpoint
          showStatus('✓ Connection successful', 'success');
          setCapabilities(null);
        }
      } else {
        showStatus(`✗ ${validation.error}`, 'error');
        setCapabilities(null);
      }
    } catch (error: any) {
      showStatus(`✗ Connection failed: ${error.message}`, 'error');
      setCapabilities(null);
    } finally {
      setTesting(false);
    }
  };

  /**
   * Handle preset selection change
   *
   * Clears capabilities when user changes selection so "Detected Mode" badge
   * disappears until they test/save the new URL
   */
  const handlePresetChange = (preset: PresetKey) => {
    setSelectedPreset(preset);
    if (preset !== 'custom') {
      setApiEndpoint(PRESET_ENDPOINTS[preset]);
    }
    // Clear capabilities when changing selection - user must test/save to re-detect
    setCapabilities(null);
    setStatusMessage(null); // Also clear any previous status messages
  };

  const showStatus = (text: string, type: 'success' | 'error' | 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-fm-bg">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-fm-blue mb-4"></div>
          <p className="text-fm-dim">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-fm-bg py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <img src="/icon/design-dark.svg" alt="FaultMaven" className="h-10 w-auto" />
            <h1 className="text-3xl font-bold text-white">FaultMaven Settings</h1>
          </div>
          <p className="text-fm-dim">Configure your FaultMaven Copilot extension</p>
        </div>

        {/* Settings Form */}
        <div className="bg-fm-surface rounded-lg border border-fm-border p-6 mb-4">
          {/* Preset Selection */}
          <div className="mb-6">
            <label htmlFor="preset-selector" className="block text-sm font-medium text-fm-text mb-2">
              Server Type
            </label>
            <select
              id="preset-selector"
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
              className="w-full px-3 py-2 border border-fm-border rounded-lg focus:outline-none focus:ring-2 focus:ring-fm-blue focus:border-transparent bg-fm-bg text-fm-text"
            >
              <option value="production">FaultMaven Cloud</option>
              <option value="localhost">Local Deployment (localhost - includes SSH tunnels)</option>
              <option value="custom">Custom Server URL (enterprise domains)</option>
            </select>
            {selectedPreset === 'localhost' && (
              <p className="mt-1 text-xs text-fm-dim">
                <strong className="text-fm-text">Local machine:</strong> Dashboard runs on localhost:3333<br/>
                <strong className="text-fm-text">Remote server:</strong> Use SSH tunnel: <code className="bg-fm-elevated px-1 rounded text-fm-yellow font-mono border border-fm-border">ssh -L 3333:localhost:3333 -L 8090:localhost:8090 user@server</code>
              </p>
            )}
            {selectedPreset === 'production' && (
              <p className="mt-1 text-xs text-fm-muted">
                Connect to FaultMaven's managed cloud service
              </p>
            )}
            {selectedPreset === 'custom' && (
              <p className="mt-1 text-xs text-fm-muted">
                For enterprise deployments with custom domains (e.g., https://faultmaven.acme.com)
              </p>
            )}
          </div>

          {/* Dashboard URL Input */}
          <div className="mb-6">
            <label htmlFor="api-endpoint" className="block text-sm font-medium text-fm-text mb-2">
              Dashboard URL
              {selectedPreset === 'custom' && <span className="text-fm-red ml-1">*</span>}
            </label>
            <input
              type="text"
              id="api-endpoint"
              value={apiEndpoint}
              onChange={(e) => {
                setApiEndpoint(e.target.value);
                // Auto-switch to custom when manually editing
                if (selectedPreset !== 'custom') {
                  setSelectedPreset('custom');
                }
                // Clear capabilities when URL changes - user must test/save to re-detect
                setCapabilities(null);
                setStatusMessage(null); // Also clear any previous status messages
              }}
              placeholder="e.g., https://faultmaven.acme.com"
              disabled={selectedPreset !== 'custom'}
              className="w-full px-3 py-2 border border-fm-border rounded-lg focus:outline-none focus:ring-2 focus:ring-fm-blue focus:border-transparent bg-fm-bg text-fm-text disabled:bg-fm-elevated disabled:text-fm-dim"
            />
            {selectedPreset === 'custom' && (
              <p className="mt-1 text-xs text-fm-dim">
                Enter your enterprise Dashboard URL with SSL (HTTPS required). For remote servers without custom domains, use <strong className="text-fm-text">Local Deployment</strong> with SSH tunnel instead.
              </p>
            )}
          </div>

          {/* Deployment Mode Display */}
          {capabilities && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-fm-text mb-2">
                Detected Mode
              </label>
              <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                capabilities.deploymentMode === 'self-hosted'
                  ? 'bg-fm-green-light text-fm-green'
                  : 'bg-fm-blue-light text-fm-blue'
              }`}>
                {capabilities.deploymentMode === 'self-hosted' ? 'Self-Hosted' : 'FaultMaven Cloud'}
              </div>
              <p className="mt-2 text-sm text-fm-dim">
                Dashboard: <a href={apiEndpoint} target="_blank" rel="noopener noreferrer" className="text-fm-blue hover:underline">{apiEndpoint}</a>
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-fm-blue text-fm-bg rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 bg-fm-elevated text-fm-text border border-fm-border rounded-lg hover:bg-fm-border disabled:opacity-50 font-medium"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${
              statusMessage.type === 'success'
                ? 'bg-fm-green-light text-fm-green border border-fm-green-border'
                : statusMessage.type === 'error'
                ? 'bg-fm-red-light text-fm-red border border-fm-border'
                : 'bg-fm-blue-light text-fm-blue border border-fm-blue-border'
            }`}>
              {statusMessage.text}
            </div>
          )}
        </div>

        {/* Help Section */}
        <div className="bg-fm-surface rounded-lg border border-fm-border p-6">
          <h2 className="text-lg font-semibold text-white mb-3">Configuration Guide</h2>
          <div className="space-y-3 text-sm text-fm-dim">
            <div>
              <strong className="font-semibold text-fm-text">FaultMaven Cloud:</strong>
              <p className="mt-1">Connects to managed service at <code className="bg-fm-elevated px-1 py-0.5 rounded text-fm-yellow font-mono border border-fm-border">https://app.faultmaven.ai</code> (default)</p>
            </div>
            <div>
              <strong className="font-semibold text-fm-text">Local Deployment:</strong>
              <p className="mt-1">Dashboard runs on port <strong className="text-fm-text">3333</strong>, API on port <strong className="text-fm-text">8090</strong></p>
              <p className="mt-1 text-xs">Use <code className="bg-fm-elevated px-1 py-0.5 rounded text-fm-yellow font-mono border border-fm-border">docker compose up</code> to start locally</p>
            </div>
            <div>
              <strong className="font-semibold text-fm-text">Custom Server:</strong>
              <p className="mt-1">For self-hosted deployments with custom domains or ports</p>
            </div>
            <div className="pt-2 border-t border-fm-border">
              <p>Always click <strong className="text-fm-text">"Test Connection"</strong> before saving</p>
              <p>Reload the extension after changing settings</p>
            </div>
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
