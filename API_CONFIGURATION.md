# API Configuration Guide

## Overview

The FaultMaven Copilot extension is configured to connect to different API endpoints based on the environment:

- **Production**: `https://api.faultmaven.ai` (default)
- **Development**: `http://api.faultmaven.local:8000` (configurable)

The extension uses a comprehensive API structure with proper session management, data upload capabilities, and query processing with enhanced response formatting. **Version 0.3.0** includes improved error handling, testing infrastructure, and accessibility features.

## Configuration Files

### 1. Main Configuration (`src/config.ts`)

```typescript
const config: Config = {
  // Production API endpoint - HTTPS required for Chrome Web Store
  apiUrl: import.meta.env.VITE_API_URL || "https://api.faultmaven.ai",
};
```

**Behavior:**
- If `VITE_API_URL` environment variable is set → uses that value
- If `VITE_API_URL` is not set → defaults to `https://api.faultmaven.ai`

### 2. API Functions (`src/lib/api.ts`)

The extension provides comprehensive API functions for all FaultMaven operations:

**Session Management:**
- `createSession()` - Create new troubleshooting session
- `listSessions()` - List all sessions
- `heartbeatSession()` - Keep session alive

**Data Upload:**
- `uploadData()` - Upload files, text, or page content for analysis

**Query Processing:**
- `processQuery()` - Send troubleshooting queries with context and priority

**Knowledge Base (Legacy):**
- `uploadKnowledgeDocument()` - Upload documents to KB
- `getKnowledgeDocuments()` - Fetch KB documents
- `deleteKnowledgeDocument()` - Delete KB documents

### 3. Testing Infrastructure

**Test Configuration (`vitest.config.ts`):**
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
  },
});
```

**Test Setup (`src/test/setup.ts`):**
- Browser API mocks for testing
- Global test utilities
- Environment simulation

**Test Coverage:**
- **Component Tests**: LoadingSpinner, ErrorBoundary, AccessibleComponents
- **API Tests**: Session management, query processing, data upload
- **Integration Tests**: User interactions and error scenarios

### 4. Environment Variables

#### For Development (`.env.local`)
```bash
# Local development API endpoint
# Uncomment the line below to use local development server
VITE_API_URL=http://api.faultmaven.local:8000
```

#### For Production
- No `.env.local` file needed
- Will automatically use `https://api.faultmaven.ai`

## Usage Scenarios

### Production Build
```bash
# Remove .env.local file (if exists)
rm .env.local

# Build for production
pnpm build
```
**Result:** Connects to `https://api.faultmaven.ai`

### Development with Local API
```bash
# Ensure .env.local exists with local endpoint
echo "VITE_API_URL=http://api.faultmaven.local:8000" > .env.local

# Start development
pnpm dev
```
**Result:** Connects to `http://api.faultmaven.local:8000`

### Development with Production API
```bash
# Remove .env.local file
rm .env.local

# Start development
pnpm dev
```
**Result:** Connects to `https://api.faultmaven.ai`

### Testing
```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests with UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

## Setup Script

Use the provided setup script for quick configuration:

```bash
# Setup for local development
./scripts/setup-dev.sh

# This will:
# 1. Create .env.local with local API endpoint
# 2. Set VITE_API_URL=http://api.faultmaven.local:8000
```

## Security & Permissions

The extension manifest (`wxt.config.ts`) includes permissions for both endpoints:

```typescript
host_permissions: [
  "https://api.faultmaven.ai/*",
  "http://api.faultmaven.local:8000/*"
],
content_security_policy: {
  "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://api.faultmaven.ai http://api.faultmaven.local:8000;"
}
```

## Error Handling & Resilience

### Error Boundaries
- **React Error Boundaries** provide crash protection throughout the app
- **Graceful error recovery** with user-friendly messages
- **Error logging** for debugging and monitoring

### API Error Handling
- **Comprehensive try-catch blocks** around all API calls
- **User-friendly error messages** with actionable feedback
- **Retry mechanisms** for transient failures
- **Fallback behaviors** when services are unavailable

## Verification

To verify which endpoint is being used:

1. **Start development**: `pnpm dev`
2. **Open extension** in browser
3. **Check browser console** for API endpoint logs (look for "Using API endpoint:")
4. **Try sending a message** to see real API calls instead of mock responses
5. **Use the test script**: `node scripts/test-api.js`
6. **Run tests**: `pnpm test` to verify API functionality

### Console Logs to Look For:
```
[SidePanelApp] Creating new session...
[SidePanelApp] createSession response: { session_id: "uuid", created_at: "..." }
[SidePanelApp] Using API endpoint: http://api.faultmaven.local:8000
[SidePanelApp] Sending query to FaultMaven backend: your message
[SidePanelApp] API response: { response: "...", findings: [...], recommendations: [...], confidence_score: 0.85 }
```

### API Endpoints Used:
- `POST /api/v1/sessions` - Create troubleshooting session
- `POST /api/v1/data/` - Upload files/logs for analysis  
- `POST /api/v1/agent/query` - Send troubleshooting queries
- `POST /api/v1/sessions/{id}/heartbeat` - Keep session alive

### Request/Response Flow:

**1. Session Creation:**
```typescript
// Request
POST /api/v1/sessions
// Response
{ session_id: "uuid", created_at: "timestamp" }
```

**2. Data Upload (Optional):**
```typescript
// Request
POST /api/v1/data/
FormData: { session_id, data_type, file/content }
// Response
{ data_id: "uuid", insights: "...", status: "success" }
```

**3. Query Processing:**
```typescript
// Request
POST /api/v1/agent/query
{
  session_id: "uuid",
  query: "Why is my service failing?",
  priority: "normal",
  context: {
    uploaded_data_ids: ["data_id"],
    page_url: "https://...",
    browser_info: "user-agent"
  }
}
// Response
{
  response: "Analysis result...",
  findings: ["Finding 1", "Finding 2"],
  recommendations: ["Recommendation 1"],
  confidence_score: 0.85,
  session_id: "uuid"
}
```

## Testing

### Test Coverage
The extension includes comprehensive testing:

- **Component Tests**: UI components with proper mocking
- **API Tests**: All API functions with mock responses
- **Integration Tests**: End-to-end user workflows
- **Error Tests**: Error scenarios and recovery

### Running Tests
```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests with UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

### Test Results
```
✓ 19 tests passed
✓ 2 test files
✓ 827ms total duration
```

## Troubleshooting

### Issue: Extension can't connect to local API
**Solution:** Ensure `.env.local` exists and contains:
```bash
VITE_API_URL=http://api.faultmaven.local:8000
```

### Issue: Session creation fails (404 error)
**Solution:** 
1. Verify the API server is running at the configured endpoint
2. Check that the endpoint supports `/api/v1/sessions`
3. Ensure proper CORS configuration on the server

### Issue: Query requests fail
**Solution:**
1. Verify session was created successfully
2. Check that the session ID is being passed correctly
3. Ensure the query endpoint `/api/v1/agent/query` is available

### Issue: Extension connects to wrong endpoint
**Solution:** 
1. Check if `.env.local` exists
2. Verify the `VITE_API_URL` value
3. Restart the development server: `pnpm dev`

### Issue: Production build connects to local API
**Solution:** Remove `.env.local` before building:
```bash
rm .env.local
pnpm build
```

### Issue: Session persistence not working
**Solution:**
1. Check browser storage permissions
2. Verify session heartbeat is working
3. Check console for session creation errors

### Issue: Tests failing
**Solution:**
1. Ensure all dependencies are installed: `pnpm install`
2. Check test configuration in `vitest.config.ts`
3. Verify test setup in `src/test/setup.ts`
4. Run tests with verbose output: `pnpm test --reporter=verbose`

### Issue: Error boundaries not catching errors
**Solution:**
1. Verify ErrorBoundary is properly wrapped around components
2. Check console for error boundary logs
3. Ensure error boundaries are not being bypassed by async operations 