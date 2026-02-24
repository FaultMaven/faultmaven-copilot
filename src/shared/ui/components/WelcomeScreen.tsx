import React, { useState } from 'react';
import { browser } from 'wxt/browser';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const [error, setError] = useState<string | null>(null);

  const handleCloudSetup = async () => {
    try {
      // Configure Dashboard URL for FaultMaven Cloud
      // No additional permissions needed - already in host_permissions
      await browser.storage.local.set({
        apiEndpoint: 'https://app.faultmaven.ai',  // Dashboard URL, not API URL
        hasCompletedFirstRun: true
      });
      onComplete();
    } catch (err) {
      setError('Failed to configure cloud deployment');
      console.error('Cloud setup error:', err);
    }
  };

  const handleSelfHostedSetup = async () => {
    try {
      // Request permissions for localhost access
      const granted = await browser.permissions.request({
        origins: [
          'http://localhost/*',
          'http://127.0.0.1/*'
        ]
      });

      if (!granted) {
        setError('Permission required to access local server. Please allow access when prompted.');
        return;
      }

      // Configure default Dashboard URL for local deployment
      await browser.storage.local.set({
        apiEndpoint: 'http://127.0.0.1:3333',  // Default local Dashboard URL
        hasCompletedFirstRun: true
      });

      // Open settings page for verification/customization
      try {
        await browser.runtime.openOptionsPage();
      } catch (optionsError) {
        console.warn('Could not open options page:', optionsError);
        // Continue anyway - settings page is optional
      }

      onComplete();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to configure local deployment: ${errorMessage}`);
      console.error('Self-hosted setup error:', err);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-fm-bg">
      <div className="max-w-2xl mx-auto p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <img
              src="/icon/square-dark.svg"
              alt="FaultMaven Logo"
              className="h-16 w-auto"
            />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome to FaultMaven Copilot
          </h1>
          <p className="text-lg text-fm-dim">
            AI-powered troubleshooting assistant for SRE and DevOps teams
          </p>
        </div>

        {/* Deployment options */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* FaultMaven Enterprise */}
          <button
            onClick={handleCloudSetup}
            className="group bg-fm-surface border-2 border-fm-blue-border rounded-xl p-6 hover:border-fm-blue hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-fm-blue-light rounded-lg flex items-center justify-center group-hover:bg-fm-blue transition-colors">
                <svg className="w-6 h-6 text-fm-blue group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white">
                FaultMaven Cloud (SaaS)
              </h3>
            </div>

            <p className="text-fm-dim mb-4">
              Best for teams. Immediate value with managed infrastructure.
            </p>

            <ul className="space-y-2 text-sm text-fm-dim mb-6">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Pre-Loaded Intelligence – Starts with a Global Knowledge Base of industry best practices</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Team Collaboration – Share runbooks and incidents across the full 3-tier knowledge system</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Enterprise Security – Fully managed with SSO, RBAC, and SOC 2 readiness</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Zero Maintenance – We handle the Kubernetes infrastructure, updates, and scaling</span>
              </li>
            </ul>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-fm-blue">Recommended</span>
              <svg className="w-5 h-5 text-fm-muted group-hover:text-fm-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Self-Hosted */}
          <button
            onClick={handleSelfHostedSetup}
            className="group bg-fm-surface border-2 border-fm-border rounded-xl p-6 hover:border-fm-dim hover:shadow-lg transition-all text-left"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-fm-elevated rounded-lg flex items-center justify-center group-hover:bg-fm-dim transition-colors">
                <svg className="w-6 h-6 text-fm-dim group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white">
                FaultMaven Open Source (Local)
              </h3>
            </div>

            <p className="text-fm-dim mb-4">
              Best for individuals. Run the full stack on your own hardware.
            </p>

            <ul className="space-y-2 text-sm text-fm-dim mb-6">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Self-Hosted Infrastructure – You own the stack. Run the Core engine directly on your hardware or Docker</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Custom Knowledge Base – Starts empty. Build a personal KB tailored exactly to your specific needs</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Offline Capable – Works entirely air-gapped with local LLMs (like Ollama)</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Self-Managed – You have full control over the container, database, and configuration</span>
              </li>
            </ul>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-fm-dim">Requires Docker</span>
              <svg className="w-5 h-5 text-fm-muted group-hover:text-fm-dim transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>

        {error && (
          <div className="mt-6 p-4 bg-fm-red-light border border-fm-red-border rounded-lg">
            <p className="text-sm text-fm-red">{error}</p>
          </div>
        )}

        <p className="text-center text-sm text-fm-muted mt-6">
          You can change this later in extension settings
        </p>
      </div>
    </div>
  );
}
