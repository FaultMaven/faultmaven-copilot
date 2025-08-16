# FaultMaven API Configuration Guide

## Overview

The FaultMaven Copilot extension supports the **v3.1.0 API specification** with intelligent response handling, improved data structures, and better user experience. The extension provides intelligent response handling with 7 different response types and comprehensive troubleshooting capabilities.

**Version 0.3.0** includes:
- **v3.1.0 API Support**: Full compatibility with current API specification
- **7 Response Types**: Intelligent response handling (ANSWER, PLAN_PROPOSAL, CLARIFICATION_REQUEST, etc.)
- **Data Management**: Session data tracking and context integration
- **Knowledge Base**: Real-time search and document management
- **Error Handling**: Structured error responses with actionable information
- **Testing**: Full test coverage for API features

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

The extension provides comprehensive API functions for all FaultMaven v3.1.0 operations:

#### **Session Management:**
- `createSession(metadata?)` - Create troubleshooting session with optional metadata
- `getSession(sessionId)` - Get session details
- `heartbeatSession(sessionId)` - Keep session alive
- `getSessionStats(sessionId)` - Get session statistics
- `cleanupSession(sessionId)` - Clean up session data
- `deleteSession(sessionId)` - Delete session

#### **Data Upload:**
- `uploadData(sessionId, data, dataType)` - Upload files, text, or page content
- `batchUploadData(sessionId, files)` - Upload multiple files at once
- `getSessionData(sessionId, limit, offset)` - Get session data with pagination

#### **Query Processing:**
- `processQuery(request)` - Send troubleshooting queries (returns `AgentResponse`)
- `troubleshoot(request)` - Legacy troubleshooting endpoint (backward compatibility)

#### **Knowledge Base:**
- `uploadKnowledgeDocument(file, title, documentType, category?, tags?, sourceUrl?, description?)` - Document upload with metadata
- `getKnowledgeDocuments(documentType?, tags?, limit, offset)` - Document retrieval with filtering
- `searchKnowledgeBase(query, documentType?, category?, tags?, limit)` - Real-time search
- `deleteKnowledgeDocument(documentId)` - Delete documents

#### **Case Management:**
- `getUserCases(filters?)` - Get user cases with filtering
- `markCaseResolved(caseId)` - Mark case as resolved

#### **Health & Monitoring:**
- `healthCheck()` - API health check
- `getSessionStats(sessionId)` - Session performance metrics

### 3. Response Handling (`src/lib/utils/response-handlers.ts`)

The extension includes intelligent response handling utilities:

#### **Response Type Information:**
```typescript
export const RESPONSE_TYPE_INFO: Record<ResponseType, ResponseTypeInfo> = {
  [ResponseType.ANSWER]: { label: 'Answer', emoji: '💬', actionRequired: false },
  [ResponseType.PLAN_PROPOSAL]: { label: 'Troubleshooting Plan', emoji: '📋', actionRequired: true },
  [ResponseType.CLARIFICATION_REQUEST]: { label: 'Need More Information', emoji: '❓', actionRequired: true },
  [ResponseType.CONFIRMATION_REQUEST]: { label: 'Please Confirm', emoji: '✅', actionRequired: true },
  [ResponseType.SOLUTION_READY]: { label: 'Solution Ready', emoji: '🎯', actionRequired: false },
  [ResponseType.NEEDS_MORE_DATA]: { label: 'Need More Data', emoji: '📊', actionRequired: true },
  [ResponseType.ESCALATION_REQUIRED]: { label: 'Escalation Required', emoji: '🚨', actionRequired: true }
};
```

#### **Utility Functions:**
- `getResponseTypeInfo(responseType)` - Get formatted response type information
- `formatConfidenceScore(score)` - Format confidence scores with emojis
- `formatSource(source)` - Format source information with appropriate icons
- `formatPlanStep(step)` - Format plan step information
- `requiresUserAction(response)` - Check if response requires user action
- `getNextActionHint(response)` - Get next action hints for users
- `formatResponseForDisplay(response)` - Complete response formatting
- `extractActionableItems(response)` - Extract actionable items from response

### 4. Data Structures

#### **Response Types:**
```typescript
export enum ResponseType {
  ANSWER = "ANSWER",
  PLAN_PROPOSAL = "PLAN_PROPOSAL",
  CLARIFICATION_REQUEST = "CLARIFICATION_REQUEST",
  CONFIRMATION_REQUEST = "CONFIRMATION_REQUEST",
  SOLUTION_READY = "SOLUTION_READY",
  NEEDS_MORE_DATA = "NEEDS_MORE_DATA",
  ESCALATION_REQUIRED = "ESCALATION_REQUIRED"
}
```

#### **Agent Response:**
```typescript
export interface AgentResponse {
  response_type: ResponseType;
  content: string;
  session_id: string;
  case_id?: string;
  confidence_score?: number;
  sources?: Source[];
  plan?: PlanStep;
  estimated_time_to_resolution?: string;
  next_action_hint?: string;
  view_state?: ViewState;
  metadata?: Record<string, any>;
}
```

#### **Data Structures:**
```typescript
export interface UploadedData {
  data_id: string;
  session_id: string;
  data_type: 'log_file' | 'error_message' | 'stack_trace' | 'metrics_data' | 'config_file' | 'documentation' | 'unknown';
  content: string;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  processing_status: string;
  insights?: Record<string, any>;
}

export interface KbDocument {
  document_id: string;
  title: string;
  content: string;
  document_type: string;
  category?: string;
  status: string;
  tags: string[];
  source_url?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any>;
}
```

### 5. Testing Infrastructure

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

**Test Coverage:**
- **API Tests** (`src/test/api/api.test.ts`): v3.1.0 API structure testing
- **Response Handler Tests** (`src/test/utils/response-handlers.test.ts`): Response utility testing
- **Component Tests**: LoadingSpinner, ErrorBoundary, AccessibleComponents
- **Integration Tests**: User interactions and error scenarios

## Usage Scenarios

### Production Build
```bash
# Remove .env.local file (if exists)
rm .env.local

# Build for production
pnpm build
```
**Result:** Connects to `https://api.faultmaven.ai` with full v3.1.0 API support

### Development with Local API
```bash
# Ensure .env.local exists with local endpoint
echo "VITE_API_URL=http://api.faultmaven.local:8000" > .env.local

# Start development
pnpm dev
```
**Result:** Connects to `http://api.faultmaven.local:8000` with full v3.1.0 API support

### Testing
```bash
# Run all tests including response handler tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests with UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

## API Endpoints

### **Data Operations:**
- `POST /api/v1/data/upload` - Upload data with response structure
- `POST /api/v1/data/batch-upload` - Batch upload multiple files
- `GET /api/v1/data/sessions/{session_id}` - Get session data with pagination

### **Knowledge Base:**
- `POST /api/v1/knowledge/documents` - Document upload with metadata
- `GET /api/v1/knowledge/documents` - Document retrieval with filtering
- `POST /api/v1/knowledge/search` - Real-time document search
- `DELETE /api/v1/knowledge/documents/{document_id}` - Document deletion

### **Session Management:**
- `POST /api/v1/sessions/` - Create session with metadata support
- `GET /api/v1/sessions/{session_id}` - Get session details
- `GET /api/v1/sessions/{session_id}/stats` - Get session statistics
- `POST /api/v1/sessions/{session_id}/cleanup` - Clean up session data

### **Case Management:**
- `GET /api/v1/cases` - Get user cases with filtering
- `PATCH /api/v1/cases/{case_id}/resolve` - Mark case as resolved

### **Health & Monitoring:**
- `GET /health` - Health check
- `GET /health/dependencies` - Dependency health check
- `GET /metrics/performance` - Performance metrics

## Request/Response Examples

### **1. Session Creation:**
```typescript
// Request
POST /api/v1/sessions
{
  "metadata": {
    "user_id": "user-123",
    "environment": "production",
    "version": "1.0.0"
  }
}

// Response
{
  "session_id": "session-abc123",
  "created_at": "2025-08-15T10:00:00Z",
  "status": "active"
}
```

### **2. Data Upload:**
```typescript
// Request
POST /api/v1/data/upload
FormData: {
  session_id: "session-abc123",
  file: File
}

// Response
{
  "data_id": "data-456",
  "session_id": "session-abc123",
  "data_type": "log_file",
  "content": "file content...",
  "file_name": "app.log",
  "file_size": 1024,
  "uploaded_at": "2025-08-15T10:05:00Z",
  "processing_status": "completed",
  "insights": { "error_count": 5, "severity": "high" }
}
```

### **3. Query Processing:**
```typescript
// Request
POST /api/v1/agent/query
{
  "session_id": "session-abc123",
  "query": "Why is my service failing?",
  "priority": "high",
  "context": {
    "uploaded_data_ids": ["data-456"],
    "page_url": "https://example.com",
    "browser_info": "user-agent"
  }
}

// Response (ANSWER type)
{
  "response_type": "ANSWER",
  "content": "Your service is failing because...",
  "session_id": "session-abc123",
  "confidence_score": 0.95,
  "sources": [
    {
      "type": "log_analysis",
      "content": "Error logs indicate connection timeout",
      "confidence": 0.9
    }
  ]
}

// Response (PLAN_PROPOSAL type)
{
  "response_type": "PLAN_PROPOSAL",
  "content": "Here is a step-by-step plan to resolve the issue",
  "session_id": "session-abc123",
  "plan": {
    "step_number": 1,
    "action": "Check system logs",
    "description": "Review recent error logs for clues",
    "estimated_time": "5 minutes"
  },
  "confidence_score": 0.9
}
```

### **4. Knowledge Base Search:**
```typescript
// Request
POST /api/v1/knowledge/search
{
  "query": "database connection timeout",
  "document_type": "troubleshooting_guide",
  "tags": ["database", "postgresql"],
  "limit": 10
}

// Response
{
  "documents": [
    {
      "document_id": "doc-789",
      "title": "PostgreSQL Connection Troubleshooting",
      "content": "Guide for resolving connection issues...",
      "document_type": "troubleshooting_guide",
      "tags": ["database", "postgresql", "connection"],
      "relevance_score": 0.95
    }
  ]
}
```

## Features

### **1. Response Type Intelligence:**
- **Automatic Detection**: UI automatically detects response type and adapts accordingly
- **Action Indicators**: Clear visual indicators when user action is required
- **Confidence Scoring**: Visual confidence level indicators with color coding
- **Source Attribution**: Proper attribution of information sources

### **2. Data Management:**
- **Session Data Tracking**: Real-time display of uploaded data in the UI
- **Data Type Classification**: Automatic classification of uploaded content
- **Context Integration**: Session data automatically included in query context
- **Batch Operations**: Support for multiple file uploads

### **3. Knowledge Base:**
- **Real-time Search**: Debounced search with instant results
- **Metadata Support**: Support for document types, categories, and tags
- **Organization**: Document categorization and display
- **Filtering**: Filter by document type, category, and tags

### **4. User Experience:**
- **Action Required Indicators**: Clear warnings when user input is needed
- **Progress Tracking**: Upload and processing feedback
- **Error Recovery**: Error handling with actionable information
- **Session Persistence**: Session management and recovery

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

### **Error Boundaries:**
- **React Error Boundaries** provide crash protection throughout the app
- **Graceful error recovery** with user-friendly messages
- **Error logging** for debugging and monitoring

### **API Error Handling:**
- **Structured error responses** with correlation IDs and timestamps
- **Comprehensive try-catch blocks** around all API calls
- **User-friendly error messages** with actionable feedback
- **Retry mechanisms** for transient failures
- **Fallback behaviors** when services are unavailable

### **Error Response Format:**
```typescript
export interface APIError {
  detail: string;
  error_type?: string;
  correlation_id?: string;
  timestamp?: string;
  context?: Record<string, any>;
}
```

## Verification

To verify the v3.1.0 API features:

1. **Start development**: `pnpm dev`
2. **Open extension** in browser
3. **Check browser console** for API endpoint logs
4. **Test response types** by asking different types of questions
5. **Verify data display** in session data section
6. **Test knowledge base search** functionality
7. **Run comprehensive tests**: `pnpm test`

### **Console Logs to Look For:**
```
[SidePanelApp] Creating new session...
[SidePanelApp] API response: { response_type: "ANSWER", content: "...", confidence_score: 0.95 }
[SidePanelApp] Using API endpoint: http://api.faultmaven.local:8000
[SidePanelApp] Response type: ANSWER, requires action: false
```

### **API Endpoints Used:**
- `POST /api/v1/sessions/` - Create session with metadata
- `POST /api/v1/data/upload` - Data upload
- `POST /api/v1/agent/query` - Query processing
- `GET /api/v1/data/sessions/{session_id}` - Get session data
- `POST /api/v1/knowledge/search` - Knowledge base search

## Testing

### **Test Coverage**
The extension includes comprehensive testing for features:

- **API Tests**: All v3.1.0 API functions with mock responses
- **Response Handler Tests**: All utility functions for response processing
- **Component Tests**: UI components with data structures
- **Integration Tests**: End-to-end user workflows with features
- **Error Tests**: Error scenarios and recovery with error formats

### **Running Tests**
```bash
# Run all tests including response handler tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests with UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

### **Test Results**
```
✓ 42 tests passed (including response handler tests)
✓ 3 test files
✓ Comprehensive coverage of v3.1.0 API features
```

## Troubleshooting

### **Issue: Response types not working**
**Solution:** 
1. Verify API server supports v3.1.0 specification
2. Check that `/api/v1/agent/query` endpoint returns response format
3. Ensure response includes `response_type` field

### **Issue: Data display not showing**
**Solution:**
1. Verify session data is being loaded correctly
2. Check that `getSessionData` API call is successful
3. Ensure session data includes required fields (data_id, data_type, etc.)

### **Issue: Knowledge base search not working**
**Solution:**
1. Verify `/api/v1/knowledge/search` endpoint is available
2. Check that search request includes required `query` field
3. Ensure response format matches expected structure

### **Issue: Response type indicators not displaying**
**Solution:**
1. Check that response includes valid `response_type` field
2. Verify response type is one of the 7 supported types
3. Ensure response handler utilities are properly imported

### **Issue: Tests failing for features**
**Solution:**
1. Ensure all dependencies are installed: `pnpm install`
2. Check that test files are in correct directories
3. Verify test setup includes utility functions
4. Run tests with verbose output: `pnpm test --reporter=verbose`

---

*Document Version: 2.0 - FINAL*  
*Last Updated**: August 2025*  
*API Version: v3.1.0*  
*Author: FaultMaven Frontend Team* 