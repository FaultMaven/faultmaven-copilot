# FaultMaven Copilot - Manual Testing Guide

**Version**: 0.4.0
**Last Updated**: 2026-01-26
**Purpose**: Comprehensive manual testing checklist for extension functionality

---

## Prerequisites

### 1. Backend Setup

Ensure backend is running:

```bash
# Check if backend is running
curl http://localhost:8090/health

# If not running, start it:
cd /home/swhouse/product/faultmaven
./faultmaven.sh start
# OR for local development:
./scripts/faultmaven-dev.sh start
```

**Expected**: Backend responds on `http://localhost:8090`

### 2. Extension Build

Verify extension is built:

```bash
ls -la /home/swhouse/product/faultmaven-copilot/.output/chrome-mv3/
```

**Expected**: Directory contains `manifest.json`, `background.js`, `sidepanel_manual.html`

If not built:

```bash
cd /home/swhouse/product/faultmaven-copilot
pnpm install
pnpm build
```

### 3. Browser Setup

**Supported Browsers**: Chrome, Brave, Edge, Firefox (with separate build)

**Load Extension**:
1. Open browser
2. Navigate to `chrome://extensions/` (or `edge://extensions/`, `brave://extensions/`)
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select: `/home/swhouse/product/faultmaven-copilot/.output/chrome-mv3/`
6. Extension should appear in toolbar

**Expected**: FaultMaven icon visible, no errors in extension details

---

## Test Categories

- [1. Installation & Loading](#1-installation--loading)
- [2. Authentication Flow](#2-authentication-flow)
- [3. Case Management](#3-case-management)
- [4. Messaging & Conversations](#4-messaging--conversations)
- [5. State Persistence](#5-state-persistence)
- [6. Error Handling](#6-error-handling)
- [7. Performance Checks](#7-performance-checks)

---

## 1. Installation & Loading

### Test 1.1: Extension Loads Successfully

**Steps**:
1. Load extension (see Prerequisites)
2. Click extension icon in toolbar
3. Observe sidepanel opens

**Expected**:
- ✅ Sidepanel opens on the right
- ✅ UI renders correctly (no blank screen)
- ✅ Login screen visible (if not logged in)
- ✅ No console errors in DevTools

**Check Console**: Open DevTools (F12) → Console tab
- ✅ No red errors
- ⚠️ Info logs are OK (`[Logger]` messages)

### Test 1.2: Manifest Validation

**Steps**:
1. Go to `chrome://extensions/`
2. Find FaultMaven Copilot
3. Click "Details"

**Expected**:
- ✅ Version: 0.4.0
- ✅ Manifest Version: 3
- ✅ No warnings or errors
- ✅ Permissions listed:
  - storage
  - sidePanel
  - activeTab
  - tabs
  - scripting

---

## 2. Authentication Flow

### Test 2.1: Fresh Login (CRITICAL - Retry Storm Check)

**Setup**: Clear extension storage first
```javascript
// In DevTools Console (on extension sidepanel):
chrome.storage.local.clear()
chrome.storage.session.clear()
// Reload extension
```

**Steps**:
1. Open DevTools → Network tab
2. Filter: `localhost:8090`
3. Click "Login" button in extension
4. Enter credentials:
   - Username: `test_user` (or create new user)
   - Password: `TestPassword123!`
5. Submit login
6. **OBSERVE NETWORK TAB**

**Expected** (CRITICAL):
- ✅ **Exactly 1 request** to `/api/v1/auth/dev-login`
- ✅ **NO RETRY STORM** (not 50-100 requests)
- ✅ Login completes in <1 second
- ✅ User redirected to case list
- ✅ Token stored (check storage: `chrome.storage.local.get('auth')`)

**Check Console**:
- ✅ No "Recovery cooldown" messages repeating
- ✅ Single login log entry
- ✅ No error messages

**Status**: ❌ FAIL if >1 request / ✅ PASS if exactly 1

### Test 2.2: Already Logged In (Persistence)

**Steps**:
1. After successful login (Test 2.1)
2. Close sidepanel (click extension icon)
3. Reopen sidepanel (click extension icon again)

**Expected**:
- ✅ User still logged in (no login screen)
- ✅ Case list visible immediately
- ✅ No new login request in Network tab
- ✅ Token loaded from storage

### Test 2.3: Logout

**Steps**:
1. While logged in, click "Logout" button (if available)
2. OR clear storage manually (see Test 2.1 setup)

**Expected**:
- ✅ Redirected to login screen
- ✅ Storage cleared (`chrome.storage.local.get('auth')` returns empty)
- ✅ No errors in console

---

## 3. Case Management

### Test 3.1: Empty Case List (CRITICAL - Refetch Storm Check)

**Setup**: Login with a user that has NO cases (or delete all cases via API)

**Steps**:
1. Login successfully
2. Open DevTools → Network tab
3. Filter: `/api/v1/cases`
4. Observe case list
5. **WAIT 10 seconds** and watch Network tab

**Expected** (CRITICAL):
- ✅ **Exactly 1 request** to `/api/v1/cases`
- ✅ **NO REFETCH STORM** (not repeated requests)
- ✅ Empty state message displayed ("No cases yet" or similar)
- ✅ Network tab shows no additional `/cases` requests after initial load

**Check Console**:
- ✅ No repeated "loadedConversationIds" logs
- ✅ No infinite loop errors

**Status**: ❌ FAIL if repeated requests / ✅ PASS if exactly 1

### Test 3.2: Create New Case

**Steps**:
1. Click "New Case" or "+ Create Case" button
2. Fill in:
   - Title: `Test Case - Manual Test`
   - Description: `Testing case creation flow`
3. Submit/Save

**Expected**:
- ✅ Case appears in list **immediately** (optimistic UI)
- ✅ API request to `/api/v1/cases` (POST) shows in Network tab
- ✅ Case gets an ID after backend response
- ✅ UI updates with real ID (if different from optimistic ID)
- ✅ No duplicate cases in list

**Check**:
- ✅ Case visible in list
- ✅ Clicking case opens conversation area

### Test 3.3: Select Existing Case (Lazy Loading)

**Setup**: Have at least 2 cases created

**Steps**:
1. In case list, click first case
2. Open DevTools → Network tab
3. Filter: `/api/v1/cases/{id}/messages`
4. Observe Network tab - should see 1 request
5. Click second case
6. Observe Network tab - should see 1 more request
7. Click first case again
8. Observe Network tab

**Expected**:
- ✅ First case: **1 request** to load messages
- ✅ Second case: **1 request** to load messages
- ✅ Re-selecting first case: **0 new requests** (already loaded)
- ✅ `loadedConversationIds` tracking prevents refetch

**Status**: ❌ FAIL if messages refetch on re-select / ✅ PASS if cached

### Test 3.4: Switch Between Cases

**Steps**:
1. Select case A
2. Wait for conversation to load
3. Select case B
4. Select case A again
5. Repeat quickly (A → B → A → B)

**Expected**:
- ✅ UI switches immediately
- ✅ Conversation loads from cache (no API delay)
- ✅ No flickering or blank states
- ✅ No duplicate API requests in Network tab

---

## 4. Messaging & Conversations

### Test 4.1: View Message History

**Setup**: Select a case with existing messages (or create messages via backend)

**Steps**:
1. Select case
2. Observe message list

**Expected**:
- ✅ Messages displayed in chronological order
- ✅ User messages on right, AI responses on left (or as designed)
- ✅ Timestamps visible
- ✅ Scroll works if many messages

### Test 4.2: Send New Message (Optimistic UI)

**Steps**:
1. Select a case
2. Type message in input: `This is a test message`
3. Open DevTools → Network tab
4. Click "Send" button
5. **OBSERVE UI IMMEDIATELY**

**Expected** (Optimistic UI):
- ✅ Message appears in list **instantly** (before API response)
- ✅ Input field clears immediately
- ✅ API request to `/api/v1/cases/{id}/queries` (POST) starts
- ✅ After API response, message updates (if needed)
- ✅ No duplicate messages

**Check Network**:
- ✅ Request to `/api/v1/cases/{case_id}/queries` (POST)
- ✅ Request body contains message content
- ✅ Response includes message ID

### Test 4.3: Message Reconciliation

**Setup**: Send a message (Test 4.2)

**Steps**:
1. Note the optimistic message ID (check DevTools console logs)
2. Wait for API response
3. Observe if message updates

**Expected**:
- ✅ Optimistic message gets replaced with real backend message
- ✅ Message ID changes to backend ID
- ✅ No duplicate messages
- ✅ Message content remains the same

### Test 4.4: Failed Message Send

**Setup**: Stop backend server temporarily

**Steps**:
1. Stop backend: `./faultmaven.sh stop`
2. Type message in input
3. Click "Send"
4. Observe UI

**Expected**:
- ✅ Message appears with "sending" indicator
- ✅ After timeout, error indicator shows (red exclamation, retry button, etc.)
- ✅ User can retry sending
- ✅ No console errors (graceful handling)

**Restart backend**: `./faultmaven.sh start`

---

## 5. State Persistence

### Test 5.1: Extension Reload (Recovery Mechanism)

**Steps**:
1. Login and select a case
2. Send a message
3. Go to `chrome://extensions/`
4. Click "Reload" button on FaultMaven extension
5. Reopen sidepanel
6. Open DevTools → Console tab

**Expected**:
- ✅ User remains logged in
- ✅ Selected case restored
- ✅ Conversation history visible
- ✅ Recovery mechanism runs **ONCE** (check console)
- ✅ **NO** repeated "Recovery cooldown active" messages
- ✅ State fully restored within 2 seconds

**Check Console**:
```
✅ GOOD: "Recovery attempt 1/5..."
❌ BAD:  "Recovery attempt 1/5..." (repeating every 100ms)
```

### Test 5.2: Browser Restart

**Steps**:
1. Login and create/select a case
2. Close browser completely
3. Reopen browser
4. Open extension sidepanel

**Expected**:
- ✅ User still logged in (token persisted)
- ✅ Last selected case restored (if designed to persist)
- ✅ No errors

### Test 5.3: Storage Integrity

**Steps**:
1. After login and case selection
2. Open DevTools → Application tab → Storage → Local Storage → Extension
3. Inspect `auth` and `cases` keys

**Expected**:
- ✅ `auth` key contains: `{ token, user, expiresAt }`
- ✅ `cases` key contains: `{ selectedCaseId, cases: [...] }`
- ✅ Data is JSON-parseable (not corrupted)

---

## 6. Error Handling

### Test 6.1: Network Failure During Login

**Steps**:
1. Disconnect network (airplane mode or disable WiFi)
2. Try to login
3. Observe error message

**Expected**:
- ✅ Error message displayed: "Network error" or "Cannot reach server"
- ✅ No infinite retries
- ✅ Retry button available
- ✅ No console errors spam

**Reconnect** and retry:
- ✅ Login succeeds after reconnect

### Test 6.2: Invalid Credentials

**Steps**:
1. Enter incorrect username/password
2. Submit login

**Expected**:
- ✅ Error message: "Invalid credentials" or similar
- ✅ No retry storm (only 1 request)
- ✅ User can try again

### Test 6.3: Backend 500 Error

**Setup**: Trigger a backend error (e.g., `/auth/me` endpoint has known issue)

**Steps**:
1. Login successfully
2. Trigger action that calls `/auth/me` (if applicable)
3. Observe UI

**Expected**:
- ✅ Error message displayed (not raw 500 error)
- ✅ User-friendly message: "Something went wrong"
- ✅ No crashes or blank screens
- ✅ Console shows error details (for debugging)

### Test 6.4: Rate Limiting (429)

**Setup**: Make >50 requests in 60 seconds (automated script or repeated actions)

**Expected**:
- ✅ Backend returns 429 status
- ✅ Extension shows "Too many requests" error
- ✅ Extension backs off and retries after delay
- ✅ No repeated 429 errors

---

## 7. Performance Checks

### Test 7.1: Startup Time

**Steps**:
1. Clear extension storage
2. Open DevTools → Performance tab
3. Start recording
4. Open extension sidepanel
5. Stop recording after UI loads

**Expected**:
- ✅ Initial render: <500ms
- ✅ Total time to interactive: <1s
- ✅ No blocking operations

### Test 7.2: API Response Times

**Steps**:
1. Login
2. Open DevTools → Network tab
3. Perform actions (list cases, send message, etc.)
4. Check timing for each request

**Expected**:
- ✅ Login: <500ms
- ✅ List cases: <200ms
- ✅ Get messages: <200ms
- ✅ Send message: <500ms
- ✅ Average: <300ms

### Test 7.3: Memory Usage

**Steps**:
1. Open extension
2. Use for 5-10 minutes (create cases, send messages, switch cases)
3. Open `chrome://extensions/` → FaultMaven Details → "Inspect views: service worker"
4. In DevTools → Memory tab → Take heap snapshot

**Expected**:
- ✅ Memory usage: <50MB for sidepanel
- ✅ No memory leaks (stable after repeated actions)
- ✅ Background service worker: <10MB

### Test 7.4: Request Count

**Critical Check**: Verify no retry/refetch storms

**Steps**:
1. Open DevTools → Network tab
2. Clear network log
3. Perform login
4. Wait 30 seconds
5. Count requests to `/auth/dev-login`

**Expected**:
- ✅ **Exactly 1 request**

**Repeat for**:
- Empty case list: 1 request to `/cases`
- Case selection: 1 request per case (first time)
- Message send: 1 request per message

---

## Test Result Template

### Test Execution Log

**Date**: _______________
**Tester**: _______________
**Browser**: _______________ (Chrome/Brave/Edge + version)
**Backend Version**: _______________
**Extension Version**: 0.4.0

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| 1.1 | Extension Loads | ✅/❌ | |
| 1.2 | Manifest Valid | ✅/❌ | |
| 2.1 | Fresh Login (Retry Storm) | ✅/❌ | **Requests made**: ____ |
| 2.2 | Persistence | ✅/❌ | |
| 2.3 | Logout | ✅/❌ | |
| 3.1 | Empty Case List (Refetch Storm) | ✅/❌ | **Requests made**: ____ |
| 3.2 | Create Case | ✅/❌ | |
| 3.3 | Lazy Loading | ✅/❌ | |
| 3.4 | Switch Cases | ✅/❌ | |
| 4.1 | View Messages | ✅/❌ | |
| 4.2 | Send Message (Optimistic UI) | ✅/❌ | |
| 4.3 | Reconciliation | ✅/❌ | |
| 4.4 | Failed Send | ✅/❌ | |
| 5.1 | Extension Reload (Recovery) | ✅/❌ | **Recovery attempts**: ____ |
| 5.2 | Browser Restart | ✅/❌ | |
| 5.3 | Storage Integrity | ✅/❌ | |
| 6.1 | Network Failure | ✅/❌ | |
| 6.2 | Invalid Credentials | ✅/❌ | |
| 6.3 | Backend Error | ✅/❌ | |
| 6.4 | Rate Limiting | ✅/❌ | |
| 7.1 | Startup Time | ✅/❌ | **Time**: _____ ms |
| 7.2 | API Response | ✅/❌ | **Avg**: _____ ms |
| 7.3 | Memory Usage | ✅/❌ | **Usage**: _____ MB |
| 7.4 | Request Count | ✅/❌ | |

**Overall Status**: ✅ PASS / ❌ FAIL

**Critical Issues Found**:
- [ ] Retry storm on login (>1 request)
- [ ] Refetch storm on empty list (>1 request)
- [ ] Recovery loop (repeated attempts)
- [ ] Memory leak
- [ ] Other: _______________

**Sign-off**: _______________

---

## Automated Testing Scripts

### Quick API Test
```bash
cd /home/swhouse/product/faultmaven
.venv/bin/python test_api_comprehensive.py
```

### Check for Retry Storms (Network Monitor)
```javascript
// Run in DevTools Console while testing:
let requestCounts = {};
let observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name.includes('localhost:8090')) {
      const url = new URL(entry.name).pathname;
      requestCounts[url] = (requestCounts[url] || 0) + 1;
    }
  }
});
observer.observe({ entryTypes: ['resource'] });

// After test, check:
console.table(requestCounts);
// Login should show: /api/v1/auth/dev-login: 1
```

---

## Troubleshooting

### Extension Won't Load
- Check manifest.json syntax
- Verify all files exist (`background.js`, `sidepanel_manual.html`)
- Check browser console for extension errors

### Login Fails
- Verify backend is running: `curl http://localhost:8090/health`
- Check Network tab for 401/403 errors
- Verify credentials are correct

### Blank Sidepanel
- Open DevTools on sidepanel
- Check for React errors
- Verify storage permissions granted

### Console Spam
- Check for `useEffect` infinite loops
- Verify recovery mechanism has cooldown
- Check `loadedConversationIds` is persisting

---

**Last Updated**: 2026-01-26
**Maintainer**: Test Engineer
**Status**: ✅ Ready for Manual Testing
