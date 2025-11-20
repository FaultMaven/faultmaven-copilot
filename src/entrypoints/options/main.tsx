import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { capabilitiesManager, type BackendCapabilities } from '../../lib/capabilities';
import '../../assets/tailwind.css';

// Preset API endpoints for quick selection
const PRESET_ENDPOINTS = {
  production: 'https://api.faultmaven.ai',
  localhost: 'http://127.0.0.1:8000',
  custom: ''
} as const;

type PresetKey = keyof typeof PRESET_ENDPOINTS;

function OptionsApp() {
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('production');
  const [apiEndpoint, setApiEndpoint] = useState('https://api.faultmaven.ai');
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
      const endpoint = stored.apiEndpoint || 'https://api.faultmaven.ai';
      setApiEndpoint(endpoint);

      // Detect which preset matches the stored endpoint
      const matchedPreset = (Object.keys(PRESET_ENDPOINTS) as PresetKey[]).find(
        key => PRESET_ENDPOINTS[key] === endpoint
      );
      setSelectedPreset(matchedPreset || 'custom');

      // Try to load capabilities
      try {
        const caps = await capabilitiesManager.fetch(endpoint);
        setCapabilities(caps);
      } catch (error) {
        console.warn('Failed to load capabilities:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Validates API endpoint by performing health check
   * Uses the lightweight health check endpoint for fast validation
   */
  const validateEndpoint = async (url: string): Promise<{ success: boolean; error?: string }> => {
    if (!url || !url.trim()) {
      return { success: false, error: 'Please enter an API endpoint' };
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'Invalid protocol. Use http:// or https://' };
      }

      // Warn about insecure HTTP for non-localhost
      if (parsedUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsedUrl.hostname)) {
        console.warn('[Settings] Insecure HTTP endpoint detected:', url);
      }
    } catch (error) {
      return { success: false, error: 'Invalid URL format' };
    }

    // Perform health check with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const healthUrl = `${url.replace(/\/$/, '')}/api/v1/auth/health`;
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
      try {
        const caps = await capabilitiesManager.fetch(trimmedUrl);
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
        try {
          const caps = await capabilitiesManager.fetch(trimmedUrl);
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
   */
  const handlePresetChange = (preset: PresetKey) => {
    setSelectedPreset(preset);
    if (preset !== 'custom') {
      setApiEndpoint(PRESET_ENDPOINTS[preset]);
    }
  };

  const showStatus = (text: string, type: 'success' | 'error' | 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <img src="/icon/design-light.svg" alt="FaultMaven" className="h-10 w-auto" />
            <h1 className="text-3xl font-bold text-gray-900">FaultMaven Settings</h1>
          </div>
          <p className="text-gray-600">Configure your FaultMaven Copilot extension</p>
        </div>

        {/* Settings Form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          {/* Preset Selection */}
          <div className="mb-6">
            <label htmlFor="preset-selector" className="block text-sm font-medium text-gray-700 mb-2">
              Server Type
            </label>
            <select
              id="preset-selector"
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="production">☁️ FaultMaven SaaS (Production)</option>
              <option value="localhost">🏠 Localhost (http://127.0.0.1:8000)</option>
              <option value="custom">⚙️ Custom Server URL</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Choose a preset or enter a custom URL below
            </p>
          </div>

          {/* API Endpoint Input */}
          <div className="mb-6">
            <label htmlFor="api-endpoint" className="block text-sm font-medium text-gray-700 mb-2">
              API Endpoint URL
              {selectedPreset === 'custom' && <span className="text-red-500 ml-1">*</span>}
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
              }}
              placeholder="https://your-server.com:8000"
              disabled={selectedPreset !== 'custom'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-600"
            />
            {selectedPreset === 'custom' && (
              <p className="mt-1 text-xs text-gray-600">
                Enter your custom API endpoint (e.g., https://api.mycompany.com or http://192.168.1.100:8000)
              </p>
            )}
          </div>

          {/* Deployment Mode Display */}
          {capabilities && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Detected Mode
              </label>
              <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                capabilities.deploymentMode === 'self-hosted'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {capabilities.deploymentMode === 'self-hosted' ? '🏠' : '☁️'}
                {capabilities.deploymentMode === 'self-hosted'
                  ? 'Self-Hosted (Open Source)'
                  : 'Enterprise (SaaS)'}
              </div>
              {capabilities.dashboardUrl && (
                <p className="mt-2 text-sm text-gray-600">
                  Dashboard: <a href={capabilities.dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{capabilities.dashboardUrl}</a>
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 font-medium"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${
              statusMessage.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : statusMessage.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}>
              {statusMessage.text}
            </div>
          )}
        </div>

        {/* Help Section */}
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-3">Need Help?</h2>
          <ul className="space-y-2 text-sm text-blue-800">
            <li>• Self-hosted users: Ensure your backend is running and accessible</li>
            <li>• Enterprise users: Use the default endpoint (api.faultmaven.ai)</li>
            <li>• Changes require refreshing the extension to take effect</li>
            <li>• Use "Test Connection" to verify your endpoint is working</li>
          </ul>
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
