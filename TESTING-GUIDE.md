# FaultMaven Copilot - Testing Guide

## Quick Start Testing

### 1. Fresh Install Test

**Goal**: Verify Welcome screen appears and first-run flow works.

**Steps**:
1. Build extension: `pnpm build`
2. Open Chrome: `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `.output/chrome-mv3`
6. Click extension icon to open side panel

**Expected Results**:
- ✅ Welcome screen appears
- ✅ Two deployment options shown: Cloud and Open Source
- ✅ No errors in console

### 2. Cloud Deployment Setup

**Steps**:
1. On Welcome screen, click "☁️ FaultMaven Cloud (SaaS)"
2. Wait for setup to complete

**Expected Results**:
- ✅ Welcome screen closes
- ✅ Loading screen appears: "Connecting to FaultMaven..."
- ✅ Storage contains:
   ```javascript
   {
     apiEndpoint: "https://app.faultmaven.ai",
     hasCompletedFirstRun: true
   }
   ```
- ✅ No permission prompts (already granted in manifest)

**Verify**:
```javascript
// In extension service worker console (chrome://extensions/ -> Service worker)
chrome.storage.local.get(null).then(data => console.log(data));
```

### 3. Local Deployment Setup

**Prerequisite**: Clear storage first:
```javascript
chrome.storage.local.clear().then(() => location.reload());
```

**Steps**:
1. On Welcome screen, click "🏠 FaultMaven Open Source (Local)"
2. Chrome prompts: "Allow FaultMaven Copilot to access localhost and 127.0.0.1?"
3. Click "Allow"

**Expected Results**:
- ✅ Permission granted
- ✅ Settings page opens (optional - may fail gracefully)
- ✅ Welcome screen closes
- ✅ Storage contains:
   ```javascript
   {
     apiEndpoint: "http://127.0.0.1:3333",
     hasCompletedFirstRun: true
   }
   ```

**If Permission Denied**:
- ✅ Error message appears: "Permission required to access local server"
- ✅ Can retry by clicking button again

### 4. OAuth Sign-In (Cloud)

**Prerequisite**: Complete Cloud deployment setup first.

**Steps**:
1. Click "Sign In" button in extension
2. New tab opens: `https://app.faultmaven.ai/auth/authorize?...`
3. Log in to Dashboard
4. Approve permissions

**Expected Results**:
- ✅ Dashboard shows consent screen
- ✅ After approval, redirects to `chrome-extension://{id}/callback?code=...`
- ✅ Callback page shows: "Authorization Successful!"
- ✅ Tab closes automatically after 2 seconds
- ✅ Extension shows authenticated state
- ✅ Storage contains tokens:
   ```javascript
   {
     access_token: "...",
     refresh_token: "...",
     expires_at: 1234567890,
     user: { ... }
   }
   ```

### 5. OAuth Sign-In (Local)

**Prerequisite**:
- Complete Local deployment setup first
- Local Dashboard running at `http://127.0.0.1:3333`

**Steps**: Same as Cloud OAuth, but with localhost URLs

**Expected Results**: Same as Cloud, but:
- ✅ Opens: `http://127.0.0.1:3333/auth/authorize?...`
- ✅ Callback: `chrome-extension://{id}/callback?code=...`

## Error Scenario Testing

### API Unreachable

**Setup**:
1. Complete setup (Cloud or Local)
2. Stop backend services

**Test**:
```javascript
// Reload extension
chrome.runtime.reload();
```

**Expected Results**:
- ✅ Shows loading screen: "Connecting to FaultMaven..."
- ✅ After timeout, shows error: "Failed to connect to backend"
- ✅ "Open Settings" button appears
- ✅ No crashes or infinite loops

### Storage Unavailable (Edge Case)

This should not happen in normal use, but the code handles it gracefully.

### OAuth State Mismatch (Security)

**Test**: Manually trigger OAuth callback with wrong state.

**Expected Results**:
- ✅ Error: "State parameter mismatch - possible CSRF attack"
- ✅ OAuth state cleaned up
- ✅ User can retry sign-in

## Console Commands (Debugging)

### Check Storage
```javascript
chrome.storage.local.get(null).then(data => console.table(data));
```

### Clear Storage
```javascript
chrome.storage.local.clear().then(() => {
  console.log('Storage cleared');
  location.reload();
});
```

### Check Auth State
```javascript
chrome.storage.local.get(['access_token', 'user']).then(data => {
  console.log('Authenticated:', !!data.access_token);
  console.log('User:', data.user);
});
```

### Force Session Refresh
```javascript
chrome.storage.local.remove('sessionId').then(() => {
  console.log('Session cleared');
  location.reload();
});
```

## Automated Testing

### Unit Tests
```bash
pnpm test
```

### Type Checking
```bash
pnpm tsc --noEmit
```

### Build Verification
```bash
pnpm build
# Check for errors in output
```

## Common Issues & Solutions

### Issue: Welcome screen doesn't appear

**Cause**: Storage already has `hasCompletedFirstRun: true`

**Solution**:
```javascript
chrome.storage.local.clear().then(() => location.reload());
```

### Issue: "ERR_NAME_NOT_RESOLVED" for api.faultmaven.ai

**Cause**: Extension trying to connect before setup complete

**Solution**: This should no longer happen with the fixes. If it does:
1. Check that `hasCompletedFirstRun` is in storage
2. Verify `useSessionManagement` is conditional

### Issue: OAuth redirects to wrong URL

**Cause**: Storage contains wrong `apiEndpoint`

**Solution**:
```javascript
chrome.storage.local.set({ apiEndpoint: 'http://127.0.0.1:3333' });
location.reload();
```

### Issue: Permission denied for localhost

**Cause**: User clicked "Deny" on permission prompt

**Solution**:
1. Go to `chrome://extensions/`
2. Click "Details" on FaultMaven Copilot
3. Scroll to "Permissions"
4. Click "Add" next to "Site access"
5. Enter: `http://localhost/*` and `http://127.0.0.1/*`

## Performance Testing

### First Load Time
- **Target**: Welcome screen appears < 500ms
- **Measure**: Open DevTools → Performance → Record → Open extension

### OAuth Flow Duration
- **Target**: Complete flow < 5 seconds (user interaction not included)
- **Measure**: From "Sign In" click to authenticated state

### Session Initialization
- **Target**: < 2 seconds
- **Measure**: From extension open to session ready

## Security Testing

### CSRF Protection
- ✅ OAuth state parameter validated
- ✅ State mismatch rejected
- ✅ PKCE parameters validated

### Token Storage
- ✅ Tokens stored in `browser.storage.local` (not accessible to web pages)
- ✅ Tokens cleared on logout
- ✅ Refresh tokens used correctly

### Permission Model
- ✅ Minimal required permissions (only Cloud URLs)
- ✅ Optional permissions requested on-demand (localhost)
- ✅ No `<all_urls>` in required permissions

## Regression Testing Checklist

Before each release, verify:

- [ ] Fresh install → Welcome screen appears
- [ ] Cloud setup → Completes without errors
- [ ] Local setup → Requests permissions → Completes
- [ ] Cloud OAuth → Sign in works
- [ ] Local OAuth → Sign in works
- [ ] Session persists across browser restarts (< 3 hours)
- [ ] Session refreshes correctly (> 3 hours)
- [ ] API errors handled gracefully
- [ ] Settings page opens correctly
- [ ] Extension icon badge updates
- [ ] No console errors
- [ ] TypeScript compiles cleanly
- [ ] Build completes successfully

---

**Last Updated**: 2026-01-25
**Extension Version**: 0.4.0
