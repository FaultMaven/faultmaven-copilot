import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { capabilitiesManager, type BackendCapabilities } from '../../lib/capabilities';
import '../../assets/tailwind.css';

function OptionsApp() {
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

  const handleSave = async () => {
    if (!apiEndpoint.trim()) {
      showStatus('Please enter an API endpoint', 'error');
      return;
    }

    setSaving(true);
    try {
      await browser.storage.local.set({ apiEndpoint: apiEndpoint.trim() });
      showStatus('Settings saved! Please refresh the extension.', 'success');

      // Try to load capabilities from new endpoint
      try {
        const caps = await capabilitiesManager.fetch(apiEndpoint.trim());
        setCapabilities(caps);
      } catch (error) {
        console.warn('Failed to load capabilities after save:', error);
        setCapabilities(null);
      }
    } catch (error) {
      showStatus('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiEndpoint.trim()) {
      showStatus('Please enter an API endpoint', 'error');
      return;
    }

    setTesting(true);
    showStatus('Testing connection...', 'info');

    try {
      const response = await fetch(`${apiEndpoint.trim()}/v1/meta/capabilities`);

      if (response.ok) {
        const caps = await response.json();
        setCapabilities(caps);
        showStatus(
          `✓ Connected to ${caps.deploymentMode} backend`,
          'success'
        );
      } else {
        showStatus(`✗ Connection failed: ${response.status}`, 'error');
        setCapabilities(null);
      }
    } catch (error: any) {
      showStatus(`✗ Connection failed: ${error.message}`, 'error');
      setCapabilities(null);
    } finally {
      setTesting(false);
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
          {/* API Endpoint */}
          <div className="mb-6">
            <label htmlFor="api-endpoint" className="block text-sm font-medium text-gray-700 mb-2">
              API Endpoint
            </label>
            <input
              type="text"
              id="api-endpoint"
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              placeholder="https://api.faultmaven.ai"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="mt-2 text-sm text-gray-600">
              <p className="mb-1"><strong>Self-hosted:</strong> <code className="px-2 py-0.5 bg-gray-100 rounded">http://localhost:8000</code></p>
              <p><strong>Enterprise:</strong> <code className="px-2 py-0.5 bg-gray-100 rounded">https://api.faultmaven.ai</code> (default)</p>
            </div>
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
