/**
 * OAuth Callback Handler
 *
 * This script runs in the callback.html page when the Dashboard redirects
 * back to the extension after user authorization.
 *
 * It extracts the authorization code and state from the URL parameters
 * and sends them to the background script for token exchange.
 */

(async function() {
    try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
            // User denied authorization or error occurred
            console.error('OAuth error:', error, errorDescription);
            showError(`Authorization failed: ${errorDescription || error}`);

            // Send error to background script
            chrome.runtime.sendMessage({
                type: 'AUTH_ERROR',
                error: error,
                error_description: errorDescription
            });

            // Close window after showing error briefly
            setTimeout(() => window.close(), 3000);
            return;
        }

        if (!code || !state) {
            const msg = 'Missing authorization code or state parameter';
            console.error(msg);
            showError(msg);

            chrome.runtime.sendMessage({
                type: 'AUTH_ERROR',
                error: 'invalid_callback',
                error_description: msg
            });

            setTimeout(() => window.close(), 3000);
            return;
        }

        // Send callback data to background script for token exchange
        chrome.runtime.sendMessage({
            type: 'AUTH_CALLBACK',
            code: code,
            state: state
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Failed to send message to background:', chrome.runtime.lastError);
                showError('Failed to communicate with extension');
                setTimeout(() => window.close(), 3000);
                return;
            }

            // Keep window open briefly to show success, then close
            if (response && response.success) {
                document.querySelector('h2').textContent = 'Authentication Successful!';
                document.querySelector('p').textContent = 'You can close this window.';
                setTimeout(() => window.close(), 2000);
            } else {
                showError(response?.error || 'Token exchange failed');
                setTimeout(() => window.close(), 3000);
            }
        });

    } catch (err) {
        console.error('Callback error:', err);
        showError(err.message || 'An unexpected error occurred');

        chrome.runtime.sendMessage({
            type: 'AUTH_ERROR',
            error: 'callback_failed',
            error_description: err.message
        });

        setTimeout(() => window.close(), 3000);
    }
})();

function showError(message) {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    document.querySelector('.spinner').style.display = 'none';
}
