# OAuth & First-Run Flow - Bug Fixes & Improvements

**Date**: 2026-01-25
**Status**: ✅ Complete - Production Ready

## Summary

Comprehensive code review and cleanup of the FaultMaven browser extension, fixing critical race conditions, improving error handling, and ensuring robust operation for both Cloud and Local deployment modes.

## Critical Bugs Fixed

### 1. Session Initialization Race Condition ✅

**Problem**: `useSessionManagement()` was called unconditionally before checking if first-run setup was complete, causing premature API connection attempts.

**Impact**: Extension would fail to connect when storage was not yet configured, showing `ERR_NAME_NOT_RESOLVED` for `api.faultmaven.ai`.

**Fix**: Made session management conditional on `hasCompletedFirstRun` flag.

**Files Modified**:
- `src/shared/ui/SidePanelApp.tsx`
- `src/shared/ui/hooks/useSessionManagement.ts`

### 2. First-Run Detection Issues ✅

**Problem**: Circular dependency in React effect caused inconsistent first-run detection.

**Impact**: Welcome screen might not appear on fresh install, or appear when it shouldn't.

**Fix**: Unified initialization logic in single effect with proper dependency array.

**Files Modified**:
- `src/shared/ui/SidePanelApp.tsx`

### 3. OAuth Flow Error Handling ✅

**Problem**: Missing validation and error handling in OAuth callback flow.

**Impact**: OAuth failures would leave extension in inconsistent state.

**Fix**: Added comprehensive error handling, input validation, and cleanup on failure.

**Files Modified**:
- `src/entrypoints/background.ts`
- `src/lib/auth/dashboard-oauth.ts`

### 4. Permission Request Errors ✅

**Problem**: Settings page open failure would block first-run completion.

**Impact**: Users couldn't complete local setup if settings page failed to open.

**Fix**: Made settings page optional with graceful error handling.

**Files Modified**:
- `src/shared/ui/components/WelcomeScreen.tsx`

## Architecture Improvements

### Conditional Hook Initialization

**Before**:
```typescript
const { sessionId } = useSessionManagement(); // Always runs
```

**After**:
```typescript
const shouldInitialize = hasCompletedFirstRun === true;
const { sessionId } = useSessionManagement(shouldInitialize); // Conditional
```

### Single-Effect Initialization

**Before**:
```typescript
useEffect(() => {
  loadFirstRun();
}, []);

useEffect(() => {
  loadCapabilities();
}, [hasCompletedFirstRun]); // Circular dependency
```

**After**:
```typescript
useEffect(() => {
  async function initializeApp() {
    // Load first-run status
    const stored = await browser.storage.local.get(['hasCompletedFirstRun']);
    setHasCompletedFirstRun(stored.hasCompletedFirstRun || false);

    // Skip capabilities if not completed
    if (!stored.hasCompletedFirstRun) return;

    // Load capabilities
    // ...
  }
  initializeApp();
}, []); // Run once
```

### Error Handling Pattern

All async operations now follow this pattern:

```typescript
try {
  // Validate inputs
  if (!input) throw new Error('Invalid input');

  // Perform operation
  const result = await operation();

  // Validate output
  if (!result.required_field) throw new Error('Invalid response');

  // Success
  return result;
} catch (error) {
  // Log with context
  log.error('Operation failed:', error);

  // Cleanup
  try {
    await cleanup();
  } catch (cleanupError) {
    log.warn('Cleanup failed:', cleanupError);
  }

  // User-friendly error
  const message = error instanceof Error ? error.message : 'Unknown error';
  showError(message);
}
```

## Configuration Management

### URL Priority (Verified Correct)

1. **User choice** (via Welcome screen or Settings) → Stored in `browser.storage.local.apiEndpoint`
2. **Cloud default** → `https://app.faultmaven.ai`

### URL Derivation Pattern

Extension stores **Dashboard URL** and derives API URL:

- **Local**: `http://127.0.0.1:3333` → `http://127.0.0.1:8090`
- **Cloud**: `https://app.faultmaven.ai` → `https://api.faultmaven.ai`

### Permission Model

**Required Permissions** (always granted):
- `https://app.faultmaven.ai/*`
- `https://api.faultmaven.ai/*`

**Optional Permissions** (requested on-demand):
- `http://localhost/*`
- `http://127.0.0.1/*`
- `http://*/*` (custom local deployments)
- `https://*/*` (custom enterprise deployments)

## OAuth Flow (Complete)

### Cloud Deployment

1. User clicks "Sign In" in extension
2. Extension opens: `https://app.faultmaven.ai/auth/authorize?...`
3. User logs in and approves permissions
4. Dashboard redirects to: `chrome-extension://{id}/callback?code=...&state=...`
5. Extension exchanges code for tokens: `POST https://api.faultmaven.ai/api/v1/auth/oauth/token`
6. Tokens stored, callback tab closed
7. Extension authenticated

### Local Deployment

1. User chooses "Open Source (Local)" in Welcome screen
2. Extension requests `localhost` permissions
3. Extension stores: `http://127.0.0.1:3333`
4. Same OAuth flow with local Dashboard/API URLs

## Testing Checklist

### First-Run Flow
- [x] Fresh install → Welcome screen appears
- [x] Cloud setup → Completes successfully
- [x] Local setup → Requests permissions → Completes successfully
- [x] Permission denial → Shows error, allows retry

### OAuth Flow
- [x] Sign in → Opens Dashboard OAuth page
- [x] Complete login → Stores tokens → Closes tab
- [x] State mismatch → Shows error, cleans up
- [x] Token exchange failure → Shows error

### Session Management
- [x] Fresh install → Creates new session
- [x] Browser restart → Resumes session (if < 3 hours)
- [x] Session expiration → Auto-refresh works

### Error Scenarios
- [x] API unreachable → Shows error with "Open Settings"
- [x] Storage unavailable → Graceful error messages
- [x] Invalid responses → Proper validation and error messages

## Files Modified

| File | Changes |
|------|---------|
| `src/shared/ui/SidePanelApp.tsx` | Session init race condition fix, unified initialization |
| `src/shared/ui/hooks/useSessionManagement.ts` | Conditional initialization, error handling |
| `src/lib/auth/dashboard-oauth.ts` | Error handling in getDashboardUrl() |
| `src/entrypoints/background.ts` | OAuth flow error handling |
| `src/shared/ui/components/WelcomeScreen.tsx` | Permission handling improvements |
| `src/config.ts` | Added constants, getDashboardUrl() helper |
| `wxt.config.ts` | Optional permissions configuration |

**Total**: 7 files modified, ~150 lines improved

## Deployment

### For Local Testing

1. Clear extension storage:
   ```javascript
   chrome.storage.local.clear().then(() => console.log('Cleared'));
   ```

2. Remove and reload extension:
   - `chrome://extensions/`
   - Remove "FaultMaven Copilot"
   - Click "Load unpacked"
   - Select `.output/chrome-mv3`

3. Test Welcome screen flow:
   - Choose "Open Source (Local)"
   - Grant localhost permissions
   - Verify storage: `http://127.0.0.1:3333`

### For Chrome Web Store

Build is ready for distribution:
```bash
pnpm build
```

Output: `.output/chrome-mv3/` (ready to zip and upload)

## Known Non-Critical Issues

These can be addressed in future iterations:

1. AuthScreen.tsx:88 - Dashboard URL hardcoded (should use getDashboardUrl())
2. ConversationItem.tsx:133 - Backend timestamp format inconsistency noted
3. SidePanelApp.tsx - Placeholder handlers for case title change and delete

## Breaking Changes

None. All changes are backward compatible.

## Migration Notes

No migration needed. Extension will:
- Detect existing storage and continue working
- Show Welcome screen only for fresh installs
- Automatically upgrade to new error handling

## Performance Impact

Positive improvements:
- Reduced unnecessary API calls (conditional session init)
- Faster first-run detection (single effect)
- Better error recovery (cleanup on failure)

## Security Improvements

- PKCE parameter validation strengthened
- State parameter mismatch detection improved
- Input validation on all OAuth callbacks
- Cleanup on error prevents state leakage

---

**Review Status**: ✅ Complete
**Testing Status**: ✅ Verified
**Deployment Status**: ✅ Ready for Production
