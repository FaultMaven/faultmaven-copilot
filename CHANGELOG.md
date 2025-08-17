# Changelog

All notable changes to the FaultMaven Copilot extension will be documented in this file.

## [0.3.1] - 2025-01-17

### 🏷️ Terminology Clarification
- **Aligned frontend terminology** with backend API schema to distinguish between "cases" (persistent troubleshooting conversations) and "sessions" (technical constructs)
- **Updated user-facing labels** to use "case" terminology for better clarity:
  - Accessibility labels: "Select case", "Rename case", "Delete case"
  - Error messages: "Failed to list cases" instead of "Failed to list sessions"
  - UI text: "No cases yet" for empty state
- **Preserved technical accuracy** by keeping session terminology for API calls and backend communication
- **Enhanced user experience** with clearer confirmation dialogs and status messages

### 🐛 Bug Fixes
- **Fixed timestamp refresh issue** where clicking "Refresh" button incorrectly updated all chat timestamps to "now"
- **Fixed TypeScript compilation** error with null session ID handling in ConversationsList component
- **Improved conversation context** management to maintain case continuity
- **Enhanced server error handling** to hide "Failed to fetch" error messages when API server is unreachable and prevent showing welcome screen when server is down

### 📚 Documentation
- **Added comprehensive terminology documentation** in `TERMINOLOGY_CLARIFICATION.md`
- **Updated existing documentation** with terminology clarification notes
- **Maintained backward compatibility** while establishing clear conceptual framework

## [0.2.0] - 2024-01-XX

### 🔌 API Integration (Major)
- **Replaced mock responses** with real API calls to FaultMaven backend
- **Updated API endpoints** to use correct FaultMaven API structure:
  - `POST /api/v1/sessions` - Session creation
  - `POST /api/v1/data/` - Data upload
  - `POST /api/v1/agent/query` - Query processing
  - `POST /api/v1/sessions/{id}/heartbeat` - Session heartbeat
- **Added proper request/response formats** matching API specification
- **Implemented session management** with persistence and heartbeat

### 🔄 Session Management
- **Real session creation** via API instead of mock UUID generation
- **Session persistence** across browser sessions using chrome.storage
- **Automatic heartbeat** every 30 seconds to keep sessions alive
- **Session continuity** for ongoing troubleshooting conversations

### 📤 Data Upload Enhancements
- **Real file upload** to `/api/v1/data/` endpoint
- **Text and page content upload** with session association
- **Upload insights** display from API response
- **Input clearing** after successful upload

### 💬 Query Processing Improvements
- **Enhanced query requests** with context, priority, and session_id
- **Rich response formatting** with findings, recommendations, and confidence scores
- **Better error handling** and debugging logs
- **Context inclusion** from uploaded data and page content

### 🔧 Configuration Updates
- **Flexible API endpoint** configuration for development and production
- **Environment variable support** via VITE_API_URL
- **Setup script** for quick development configuration
- **Updated permissions** for both local and production endpoints

### 🧩 UI/UX Improvements
- **Maintained refined layout** from previous phase
- **Enhanced error messages** and status indicators
- **Better loading states** and user feedback
- **Improved conversation flow** with real API responses

### 📚 Documentation
- **Updated README.md** with new API configuration instructions
- **Enhanced API_CONFIGURATION.md** with comprehensive endpoint documentation
- **Added troubleshooting guide** for common API issues
- **Created test scripts** for configuration verification

### 🛠️ Technical Improvements
- **TypeScript interfaces** for all API request/response types
- **Proper error handling** with detailed error messages
- **Debug logging** for API calls and responses
- **Code organization** with clear separation of concerns

## [0.1.0] - 2024-01-XX

### 🎨 UI Refinement (Phase 1)
- **Refined layout** with space-efficient, bordered sections
- **Visual hierarchy** improvements with de-emphasized secondary actions
- **Radio button alignment** with action buttons
- **Contextual input display** based on data source selection
- **Button enable logic** for valid input validation
- **Compact, fixed buttons** with consistent sizing

### 📐 Component Structure
- **Tabbed interface** with Copilot and Knowledge Base views
- **Conversation history** with user/AI message styling
- **Data submission** with multiple input types
- **Status indicators** for page analysis and file uploads

### 🔧 Development Setup
- **WXT framework** integration with React 19+
- **Tailwind CSS** styling with responsive design
- **TypeScript** for type safety
- **Chrome extension** manifest V3 compliance

---

## Migration Guide

### From Mock Responses to Real API

**Before (Mock):**
```typescript
await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate API
addToConversation(undefined, `Mock response for: "${query}"`);
```

**After (Real API):**
```typescript
const response = await sendQuery({
  session_id: sessionId,
  query: query,
  priority: "normal",
  context: { /* ... */ }
});
addToConversation(undefined, response.response);
```

### Configuration Changes

**Environment Setup:**
```bash
# Old way
VITE_API_BASE_URL=http://localhost:8000

# New way
VITE_API_URL=http://api.faultmaven.local:8000
```

### API Endpoint Changes

**Old Endpoints (Removed):**
- `POST /chat` - Wrong endpoint
- `POST /analyze` - Wrong endpoint

**New Endpoints:**
- `POST /api/v1/sessions` - Session creation
- `POST /api/v1/data/` - Data upload
- `POST /api/v1/agent/query` - Query processing
- `POST /api/v1/sessions/{id}/heartbeat` - Session heartbeat 