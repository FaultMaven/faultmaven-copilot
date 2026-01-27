# Logging Migration Plan

This document tracks the migration from raw `console.log` calls to structured logging using `createLogger`.

## Categorization by Side Effects

Files are categorized based on their failure impact to prioritize migration work.

### Category 1: Silent Failures (HIGHEST PRIORITY)

**Impact:** Errors go unnoticed, data corruption possible
**Strategy:** Replace with `log.error` + user-facing notifications

| File | Current State | Priority | Notes |
|------|---------------|----------|-------|
| `lib/utils/data-integrity.ts` | ✅ Done | Done | Uses createLogger |
| `lib/auth/token-manager.ts` | ✅ Done | Done | Uses createLogger |
| `lib/optimistic/PendingOperationsManager.ts` | ✅ Done | Done | Uses createLogger |
| `lib/optimistic/IdMappingManager.ts` | ✅ Done | Done | Uses createLogger |

### Category 2: High Traffic (MEDIUM PRIORITY)

**Impact:** Console noise makes debugging difficult
**Strategy:** Strictly use `log.debug` for state changes

| File | Current State | Priority | Notes |
|------|---------------|----------|-------|
| `shared/ui/components/ChatInterface.tsx` | ✅ Done | Done | Uses createLogger |
| `shared/ui/SidePanelApp.tsx` | ✅ Done | Done | Uses createLogger |
| `shared/ui/hooks/useMessageSubmission.ts` | ✅ Done | Done | Uses createLogger |

### Category 4: API & Services (ADDITIONAL)

**Impact:** API debugging, network issues
**Strategy:** Use `log.debug` for responses, `log.error` for failures

| File | Current State | Priority | Notes |
|------|---------------|----------|-------|
| `lib/api/files-service.ts` | ✅ Done | Done | Uses createLogger |
| `lib/capabilities.ts` | ✅ Done | Done | Uses createLogger |
| `lib/errors/useErrorHandler.tsx` | ✅ Done | Done | Uses createLogger |
| `entrypoints/page-content.content.ts` | ✅ Done | Done | Uses createLogger |

### Category 3: Legacy UI (GOLD STANDARD MIGRATION)

**Impact:** User-visible components, high visibility
**Strategy:** Use as reference example for the team

| File | Current State | Priority | Notes |
|------|---------------|----------|-------|
| `shared/ui/components/ConversationsList.tsx` | Done | Done | Gold standard (commit bfaae77) |

## Gold Standard Reference: ConversationsList.tsx

**Commit:** `bfaae77`

### Before
- 20 raw `console.log` calls
- ~150 LOC with logging
- Full JSON.stringify of API responses
- Emojis in log messages
- Redundant logs (3 per action)

### After
- 11 structured `log.*` calls
- ~130 LOC with logging
- Summary logging only
- Clear text messages
- Consolidated logs (1 per action)

### Key Transformations

```typescript
// BEFORE (verbose, production-visible):
console.log('[ConversationsList] RAW API RESPONSE:', JSON.stringify(list, null, 2));

// AFTER (structured, debug-only):
log.debug('Fetched cases from API', { count: list.length, hasOptimistic: pendingCases.length > 0 });

// BEFORE (redundant):
console.log('[ConversationsList] updateCaseTitle called:', { caseId, title });
console.log('[ConversationsList] Current caseTitles before update:', caseTitles);
console.log('[ConversationsList] Updated caseTitles:', updated);

// AFTER (consolidated):
log.info('Case title updated', { caseId, newTitle: title });

// BEFORE (emoji):
console.log('[ConversationsList] Added to recentlyDeleted:', caseId);

// AFTER (clear text):
log.info('Case marked for deletion', { caseId, autoCleanupIn: '5s' });
```

## Migration Progress

| Category | Total Files | Migrated | Remaining | % Complete |
|----------|-------------|----------|-----------|------------|
| Silent Failures | 4 | 4 | 0 | 100% |
| High Traffic | 3 | 3 | 0 | 100% |
| Legacy UI | 1 | 1 | 0 | 100% |
| API & Services | 4 | 4 | 0 | 100% |
| **TOTAL** | **12** | **12** | **0** | **100%** |

## Production Behavior

```typescript
// Development (VITE_DEBUG=false):
log.debug('...')  // Stripped
log.info('...')   // Stripped
log.warn('...')   // Logged
log.error('...')  // Logged

// Production Build:
log.debug('...')  // Dead code eliminated (0 bytes)
log.info('...')   // Dead code eliminated (0 bytes)
log.warn('...')   // Logged
log.error('...')  // Logged + future Sentry integration
```

## ESLint Enforcement

### Current: Stage 1 (Warnings)
```javascript
'no-console': ['warn', { allow: ['warn', 'error'] }]
```

### Future: Stage 2 (Errors)
After migration is complete, upgrade to:
```javascript
'no-console': ['error', { allow: ['warn', 'error'] }]
```

## Timeline

| Week | Tasks |
|------|-------|
| Week 1 | ConversationsList.tsx gold standard (DONE) |
| Week 2 | Silent failures (data-integrity, optimistic managers) |
| Week 3 | High traffic (ChatInterface, SidePanelApp) |
| Week 4 | ESLint upgrade to "error" level |

## How to Migrate a File

1. **Find console.log calls:**
   ```bash
   pnpm lint | grep "no-console"
   ```

2. **Add logger import:**
   ```typescript
   import { createLogger } from '~/lib/utils/logger';
   const log = createLogger('ComponentName');
   ```

3. **Replace each console call** using the log level criteria from CONTRIBUTING.md

4. **Test in development:**
   ```bash
   VITE_DEBUG=true pnpm dev
   ```

5. **Verify production behavior:**
   ```bash
   pnpm build
   grep -r "console.log" .output/chrome-mv3/ || echo "Clean!"
   ```

6. **Update this file** with migration status
