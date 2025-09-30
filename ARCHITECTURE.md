# FaultMaven Copilot Architecture

## Overview

FaultMaven Copilot is a browser extension providing AI-powered troubleshooting assistance embedded directly in the browser. Built with WXT framework, React 19+, and TypeScript, it delivers an optimistic, responsive user experience with instant feedback and robust error handling.

### Core Design Principles

1. **Optimistic Updates**: Instant UI response (0ms) with background API synchronization
2. **Session Persistence**: Client-based session management with automatic recovery
3. **Privacy-First**: All data sanitized through backend PII redaction before LLM processing
4. **Multi-Browser Support**: Chrome (Manifest V3) and Firefox compatibility
5. **Accessible**: WCAG 2.1 AA compliant with keyboard navigation and screen reader support

### Technology Stack

- **Framework**: WXT v0.20.6 (modern WebExtension toolkit)
- **UI**: React 19+, TypeScript, Tailwind CSS
- **Build**: Vite-based with hot module reloading
- **Testing**: Vitest with React Testing Library
- **Storage**: Browser storage API (chrome.storage.local)
- **Backend**: RESTful API integration with FaultMaven

---

## API Architecture

### API Versioning

**Current Version**: v3.1.0

The extension communicates with the FaultMaven backend through versioned RESTful APIs. All endpoints follow the pattern: `{baseUrl}/api/v1/{resource}`

### Configuration

Environment-based API endpoint configuration:

```typescript
// src/config.ts
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'https://api.faultmaven.ai';
```

**Production**: `https://api.faultmaven.ai`
**Development**: `http://api.faultmaven.local:8000`

### Authentication

**Auth Flow**:
1. Development login via `/api/v1/auth/dev-login` (no credentials required)
2. Receive JWT access token with expiration timestamp
3. Store auth state in browser storage
4. Include `Authorization: Bearer {token}` header in subsequent requests
5. Auto-refresh or re-authenticate on 401 responses

**Auth State Structure**:
```typescript
interface AuthState {
  access_token: string;
  token_type: "bearer";
  expires_at: number;  // Unix timestamp (ms)
}
```

### Core Endpoints

#### Session Management

**Create Session**
```
POST /api/v1/sessions
Content-Type: application/json

Request:
{
  "client_id": "uuid-v4-string",
  "session_type": "troubleshooting",
  "timeout_minutes": 180,  // 60-480 range
  "metadata": {}           // Optional
}

Response:
{
  "session_id": "uuid-v4-string",
  "client_id": "uuid-v4-string",
  "created_at": "2024-01-15T10:30:00Z",
  "status": "active",
  "last_activity": "2024-01-15T10:30:00Z",
  "session_type": "troubleshooting",
  "metadata": {},
  "session_resumed": false,
  "message": "Session created successfully"
}
```

**Key Features**:
- Client-based session resumption (same `client_id` resumes existing session)
- Automatic session recovery after browser crashes
- Configurable timeout (default: 180 minutes, range: 60-480)
- Session metadata for contextual information

**Session Heartbeat**
```
POST /api/v1/sessions/{session_id}/heartbeat

Response: 200 OK (extends session timeout)
```

**Delete Session**
```
DELETE /api/v1/sessions/{session_id}

Response: 200 OK
```

#### Troubleshooting Queries

**Process Query**
```
POST /api/v1/agent/query
Content-Type: application/json
X-Session-Id: {session_id}

Request:
{
  "query": "string",              // User question
  "context": "string",            // Optional page content
  "data": [],                     // Optional uploaded data references
  "session_id": "uuid-v4-string"
}

Response:
{
  "response": "string",           // AI response with markdown
  "session_id": "uuid-v4-string",
  "sources": [                    // Citation sources
    {
      "id": "string",
      "title": "string",
      "content": "string",
      "relevance_score": 0.95,
      "source_type": "knowledge_base",
      "metadata": {}
    }
  ]
}
```

**Response Format**:
- Markdown-formatted text with inline source citations
- Citations format: `[1], [2]` referencing `sources` array
- Source types: `knowledge_base`, `web_search`, `uploaded_data`

#### Data Upload

**Upload Data**
```
POST /api/v1/data/upload
Content-Type: multipart/form-data

Form Data:
- file: File          // Optional: file upload
- data: string        // Optional: text data
- session_id: string
- data_type: string   // "logs", "config", "page_content", "other"

Response:
{
  "data_id": "uuid-v4-string",
  "filename": "string",
  "upload_time": "2024-01-15T10:30:00Z",
  "size_bytes": 1024
}
```

**Supported Formats**: Text files, JSON, YAML, logs, configuration files

#### Knowledge Base

**Upload Document**
```
POST /api/v1/knowledge/upload
Content-Type: multipart/form-data

Form Data:
- file: File
- title: string       // Optional
- tags: string[]      // Optional

Response:
{
  "document_id": "uuid-v4-string",
  "title": "string",
  "filename": "string",
  "upload_time": "2024-01-15T10:30:00Z",
  "status": "processing",
  "size_bytes": 2048,
  "page_count": 5       // For PDFs
}
```

**Get Documents**
```
GET /api/v1/knowledge/documents
Authorization: Bearer {token}

Response:
{
  "documents": [
    {
      "id": "uuid-v4-string",
      "title": "string",
      "filename": "string",
      "upload_time": "2024-01-15T10:30:00Z",
      "status": "ready",
      "size_bytes": 2048,
      "tags": []
    }
  ]
}
```

**Get Single Document**
```
GET /api/v1/knowledge/documents/{document_id}
Authorization: Bearer {token}

Response:
{
  "id": "uuid-v4-string",
  "title": "string",
  "filename": "string",
  "content": "string",          // Extracted text content
  "upload_time": "2024-01-15T10:30:00Z",
  "status": "ready",
  "metadata": {
    "page_count": 5,
    "file_type": "pdf"
  }
}
```

**Delete Document**
```
DELETE /api/v1/knowledge/documents/{document_id}
Authorization: Bearer {token}

Response: 200 OK
```

### Data Structures

#### Source Citation
```typescript
interface Source {
  id: string;                    // Unique identifier
  title: string;                 // Display title
  content: string;               // Excerpt or full content
  relevance_score: number;       // 0.0-1.0
  source_type: "knowledge_base" | "web_search" | "uploaded_data";
  metadata: {
    document_id?: string;        // For KB sources
    url?: string;                // For web sources
    page_number?: number;        // For PDF sources
  };
}
```

#### User Case (Session)
```typescript
interface UserCase {
  id: string;                    // Session ID
  title: string;                 // Generated or user-provided
  created_at: string;            // ISO 8601 timestamp
  updated_at: string;            // ISO 8601 timestamp
  status: "active" | "archived";
  conversation: ConversationItem[];
}
```

#### Conversation Item
```typescript
interface ConversationItem {
  id: string;
  question: string;
  response: string;              // Markdown with citations
  sources?: Source[];
  timestamp: string;
  error: boolean;

  // Optimistic update metadata
  optimistic?: boolean;          // True if not yet confirmed by backend
  loading?: boolean;             // True if request in progress
  failed?: boolean;              // True if request failed
  pendingOperationId?: string;   // For ID reconciliation
  originalId?: string;           // Original ID before reconciliation
}
```

### Error Handling

**Standard Error Response**:
```typescript
{
  "detail": "string",            // Human-readable error message
  "status_code": number,         // HTTP status code
  "error_type": "string"         // Optional: error category
}
```

**Common Status Codes**:
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Authentication required or token expired
- `404 Not Found`: Resource not found (session, document, etc.)
- `410 Gone`: Session expired or invalidated
- `413 Payload Too Large`: File upload exceeds size limit
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Backend error

**Client-Side Error Handling**:
```typescript
async function handleApiError(response: Response) {
  if (response.status === 401) {
    await clearAuthState();
    throw new AuthenticationError("Please sign in again");
  }

  const error = await response.json().catch(() => ({}));
  throw new Error(error.detail || `Request failed: ${response.status}`);
}
```

### Rate Limiting

**Limits** (per user, per minute):
- Query endpoints: 30 requests
- Upload endpoints: 10 requests
- Knowledge base reads: 60 requests

**Response Headers**:
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1642248600
```

---

## Component Architecture

### Component Hierarchy

```
SidePanelApp (Root)
├── Sidebar
│   ├── Logo/CollapsedLogo
│   ├── Menu Items (New Chat, Knowledge Base)
│   ├── ConversationsList
│   │   └── ConversationItem (multiple)
│   └── Logout Button
└── Main Content Area (Tab-based)
    ├── ChatWindow (Copilot Tab)
    │   ├── Message List
    │   │   ├── User Message
    │   │   └── AI Response with Sources
    │   └── MessageInput
    └── KnowledgeBaseView (Knowledge Base Tab)
        ├── Upload Area
        └── DocumentList
            └── DocumentItem (multiple)
```

### State Management

**Top-Level State** (SidePanelApp):
```typescript
// Authentication
const [authState, setAuthState] = useState<AuthState | null>(null);
const [isAuthenticated, setIsAuthenticated] = useState(false);

// Navigation
const [activeTab, setActiveTab] = useState<'copilot' | 'knowledgeBase'>('copilot');
const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

// Session Management
const [sessionId, setSessionId] = useState<string | null>(null);
const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
const [hasUnsavedNewChat, setHasUnsavedNewChat] = useState(false);

// Conversations
const [conversations, setConversations] = useState<UserCase[]>([]);
const [currentConversation, setCurrentConversation] = useState<ConversationItem[]>([]);

// Knowledge Base
const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
```

**Data Flow Pattern**:
1. User action triggers state update in parent component
2. Parent updates state and persists to browser storage
3. State flows down to child components via props
4. Child components trigger callbacks to update parent state
5. Optimistic updates create temporary state immediately
6. Background API calls update state upon completion

### Core Components

#### SidePanelApp

**Purpose**: Main application orchestrator managing authentication, navigation, sessions, and data flow.

**Key Responsibilities**:
- Authentication state management
- Tab navigation (Copilot ↔ Knowledge Base)
- Session lifecycle (create, resume, delete)
- Conversation management (CRUD operations)
- Local storage persistence
- Optimistic update coordination

**Props Interface**:
```typescript
// Root component - no props
```

**Key Methods**:
```typescript
// Session Management
handleNewSession(initialMessage: string): Promise<void>
handleCaseSelect(caseId: string): Promise<void>
handleDeleteCase(caseId: string): Promise<void>

// Message Handling
handleSendMessage(question: string, context?: string): Promise<void>

// Storage Persistence
loadConversationsFromStorage(): Promise<void>
saveConversationsToStorage(): Promise<void>

// Optimistic Operations
addOptimisticMessage(question: string): string  // Returns optimistic ID
confirmOptimisticMessage(optimisticId: string, realId: string, response: string)
failOptimisticMessage(optimisticId: string, error: string)
```

**Storage Keys**:
- `sessionId`: Current session UUID
- `sessionCreatedAt`: Session creation timestamp
- `sessionResumed`: Boolean indicating resumed session
- `clientId`: Persistent client identifier
- `authState`: Authentication state object
- `conversations`: Serialized conversation history

#### ChatWindow

**Purpose**: Displays conversation messages with optimistic visual feedback and source citations.

**Props Interface**:
```typescript
interface ChatWindowProps {
  conversation: ConversationItem[];
  onSendMessage: (question: string, context?: string) => Promise<void>;
  onDocumentView: (documentId: string) => void;
  sessionId?: string | null;
}
```

**Key Features**:
- Markdown rendering with syntax highlighting
- Inline source citations with click-to-view
- Optimistic message indicators (blue background, spinning icon)
- Error states (red indicators)
- Auto-scroll to latest message
- Message timestamps

**Visual Indicators**:
```typescript
// Optimistic (pending) message: Blue background + "Thinking..." with spinner
// Confirmed message: Standard background
// Failed message: Red "Failed" indicator
```

#### ConversationsList

**Purpose**: Displays list of conversation sessions with search/filter capabilities.

**Props Interface**:
```typescript
interface ConversationsListProps {
  conversations: UserCase[];
  activeCaseId: string | null;
  hasUnsavedNewChat: boolean;
  onSelectConversation: (caseId: string) => void;
  onDeleteConversation: (caseId: string) => void;
  onRenameConversation: (caseId: string, newTitle: string) => void;
  onGenerateTitle: (caseId: string) => void;
  onPinConversation: (caseId: string, pinned: boolean) => void;
}
```

**Key Features**:
- Active conversation highlighting
- "New Chat (new)" indicator for unsaved sessions
- Pinned conversations at top
- Search/filter functionality
- Empty state handling

#### ConversationItem

**Purpose**: Individual conversation list item with actions menu.

**Props Interface**:
```typescript
interface ConversationItemProps {
  session: Session;
  title?: string;
  isActive: boolean;
  isUnsavedNew?: boolean;
  isPinned?: boolean;
  isPending?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onRename?: (sessionId: string, newTitle: string) => void;
  onGenerateTitle?: (sessionId: string) => void;
  onPin?: (sessionId: string, pinned: boolean) => void;
}
```

**Key Features**:
- Click to select conversation
- Three-dot menu with actions:
  - Generate Title (AI-generated)
  - Rename
  - Pin/Unpin
  - Delete
- Menu hidden for unsaved "New Chat" items
- Visual pin indicator (📌) for pinned conversations
- Click-outside handler to close menu

#### MessageInput

**Purpose**: Text input for user questions with context capture.

**Props Interface**:
```typescript
interface MessageInputProps {
  onSendMessage: (question: string, context?: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}
```

**Key Features**:
- Multi-line textarea with auto-resize
- Enter to send (Shift+Enter for new line)
- Optional page content capture
- Loading state during message submission
- Character counter (optional)

#### KnowledgeBaseView

**Purpose**: Document management interface for team knowledge base.

**Props Interface**:
```typescript
interface KnowledgeBaseViewProps {
  documents: KnowledgeDocument[];
  onUploadDocument: (file: File, title?: string, tags?: string[]) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onViewDocument: (documentId: string) => void;
  onRefreshDocuments: () => Promise<void>;
}
```

**Key Features**:
- Drag-and-drop file upload
- File browser upload button
- Upload progress indicators
- Document list with metadata (size, upload date, status)
- Document preview/view capability
- Delete with confirmation
- Real-time status updates (processing → ready)

### Props Flow Pattern

**Parent → Child Data Flow**:
```typescript
<SidePanelApp>
  ↓ conversations, activeCaseId, callbacks
  <ConversationsList>
    ↓ session, isActive, callbacks
    <ConversationItem />
  </ConversationsList>

  ↓ conversation, callbacks
  <ChatWindow>
    ↓ conversation items
    <MessageList />
    ↓ onSendMessage
    <MessageInput />
  </ChatWindow>
</SidePanelApp>
```

**Child → Parent Event Flow**:
```typescript
<MessageInput onSendMessage={(q) => handleSendMessage(q)} />
  ↑ User types and clicks send
<ChatWindow onSendMessage={handleSendMessage} />
  ↑ Forwards to parent
<SidePanelApp handleSendMessage={async (q) => {
  const id = addOptimisticMessage(q);
  try {
    const response = await processQuery(q);
    confirmOptimisticMessage(id, response);
  } catch (error) {
    failOptimisticMessage(id, error);
  }
}} />
```

### Storage Persistence Strategy

**Persistence Pattern**:
```typescript
// Load on mount
useEffect(() => {
  loadConversationsFromStorage();
}, []);

// Save on state change
useEffect(() => {
  if (conversations.length > 0) {
    saveConversationsToStorage();
  }
}, [conversations]);
```

**Storage Implementation**:
```typescript
async function loadConversationsFromStorage() {
  const result = await browser.storage.local.get(['conversations']);
  if (result.conversations) {
    setConversations(JSON.parse(result.conversations));
  }
}

async function saveConversationsToStorage() {
  await browser.storage.local.set({
    conversations: JSON.stringify(conversations)
  });
}
```

**Storage Cleanup**:
- Session deletion removes from storage immediately
- Old sessions auto-archived after 30 days (backend manages)
- Storage quota monitoring (5MB limit for chrome.storage.local)

---

## Optimistic Updates System

### Core Principles

**Optimistic UI** provides instant feedback by:
1. Updating UI immediately when user takes action
2. Making API call in background
3. Reconciling UI state when API responds
4. Reverting or marking as failed if API fails

**Benefits**:
- 0ms response time (perceived performance)
- Reduces user wait time and frustration
- Graceful degradation on network issues
- Better user experience than loading spinners

### Architecture Overview

**Components**:
1. **ID Generation**: Unique optimistic IDs with reconciliation to real IDs
2. **State Management**: Tracking optimistic vs confirmed data
3. **Visual Feedback**: UI indicators for pending/confirmed/failed states
4. **Error Recovery**: Automatic retry and failure handling

### ID Generation and Reconciliation

**Optimistic ID Generator**:
```typescript
export class OptimisticIdGenerator {
  private static counter = 0;

  static generate(): string {
    return `opt_${Date.now()}_${++this.counter}`;
  }

  static isOptimistic(id: string): boolean {
    return id.startsWith('opt_');
  }
}
```

**ID Reconciliation Flow**:
```typescript
// 1. Generate optimistic ID
const optimisticId = OptimisticIdGenerator.generate();  // "opt_1642248600000_1"

// 2. Create optimistic message
const optimisticMessage = {
  id: optimisticId,
  question: "What causes high CPU usage?",
  response: "",
  optimistic: true,
  loading: true,
  pendingOperationId: optimisticId
};

// 3. Add to UI immediately
setConversation([...conversation, optimisticMessage]);

// 4. Make API call
const response = await processQuery(optimisticMessage.question);

// 5. Reconcile with real ID
const realId = response.message_id;  // "550e8400-e29b-41d4-a716-446655440000"

// 6. Update message with real data
setConversation(prev => prev.map(msg =>
  msg.id === optimisticId
    ? {
        ...msg,
        id: realId,
        response: response.response,
        sources: response.sources,
        optimistic: false,
        loading: false,
        originalId: optimisticId
      }
    : msg
));
```

**ID Utility Functions**:
```typescript
export class IdUtils {
  // Find message by optimistic or real ID
  static findById(
    items: ConversationItem[],
    id: string
  ): ConversationItem | undefined {
    return items.find(item =>
      item.id === id ||
      item.pendingOperationId === id ||
      item.originalId === id
    );
  }

  // Replace optimistic ID with real ID
  static reconcileId(
    items: ConversationItem[],
    optimisticId: string,
    realId: string
  ): ConversationItem[] {
    return items.map(item =>
      item.id === optimisticId
        ? { ...item, id: realId, originalId: optimisticId }
        : item
    );
  }
}
```

### State Management

**Optimistic Message States**:
```typescript
interface OptimisticMetadata {
  optimistic?: boolean;          // True if not yet confirmed
  loading?: boolean;             // True if API call in progress
  failed?: boolean;              // True if API call failed
  pendingOperationId?: string;   // Optimistic ID for reconciliation
  originalId?: string;           // Original optimistic ID after reconciliation
}
```

**State Transitions**:
```
[Initial State]
  ↓
[Optimistic: true, Loading: true, Failed: false]
  ↓ (API call in progress)
[Optimistic: false, Loading: false, Failed: false]  ← Success
  OR
[Optimistic: true, Loading: false, Failed: true]   ← Failure
```

**State Management Pattern**:
```typescript
// Add optimistic message
function addOptimisticMessage(question: string): string {
  const optimisticId = OptimisticIdGenerator.generate();
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const userMessage: ConversationItem = {
    id: optimisticId + '_user',
    question,
    response: '',
    error: false,
    timestamp,
    optimistic: true,
    loading: false,
    pendingOperationId: optimisticId + '_user'
  };

  const aiMessage: ConversationItem = {
    id: optimisticId + '_ai',
    question: '',
    response: '',
    error: false,
    timestamp,
    optimistic: true,
    loading: true,
    pendingOperationId: optimisticId + '_ai'
  };

  setCurrentConversation(prev => [...prev, userMessage, aiMessage]);
  return optimisticId;
}

// Confirm optimistic message with real data
function confirmOptimisticMessage(
  optimisticId: string,
  realId: string,
  response: string,
  sources?: Source[]
) {
  setCurrentConversation(prev => prev.map(item => {
    if (item.pendingOperationId === optimisticId + '_ai') {
      return {
        ...item,
        id: realId,
        response,
        sources,
        optimistic: false,
        loading: false,
        originalId: item.id
      };
    }
    return item;
  }));
}

// Mark optimistic message as failed
function failOptimisticMessage(optimisticId: string, errorMessage: string) {
  setCurrentConversation(prev => prev.map(item => {
    if (item.pendingOperationId === optimisticId + '_ai') {
      return {
        ...item,
        response: errorMessage,
        error: true,
        optimistic: true,
        loading: false,
        failed: true
      };
    }
    return item;
  }));
}
```

### Visual Feedback

**Message Indicators**:

**Pending (Optimistic + Loading)**:
- Blue background tint (`bg-blue-50/30`)
- Spinning refresh icon
- "Thinking..." text in blue

**Confirmed (Not Optimistic)**:
- Standard background
- No special indicators
- Normal message styling

**Failed (Optimistic + Failed)**:
- Red "Failed" indicator with X icon
- Error message text
- Red text color (`text-red-600`)

**UI Implementation**:
```typescript
// AI Response Message
<div className={`px-2 py-1 text-sm border-t border-b rounded ${
  item.optimistic
    ? 'border-blue-200 bg-blue-50/30'   // Pending state
    : 'border-gray-200'                 // Confirmed state
}`}>
  <InlineSourcesRenderer content={item.response} sources={item.sources} />

  <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-2">
    <span>{item.timestamp}</span>

    {/* Thinking indicator */}
    {item.optimistic && item.loading && !item.failed && (
      <span className="text-blue-600 flex items-center gap-1">
        <svg className="w-3 h-3 animate-spin" ...>...</svg>
        Thinking...
      </span>
    )}

    {/* Failed indicator */}
    {item.failed && (
      <span className="text-red-600 flex items-center gap-1">
        <svg className="w-3 h-3" ...>...</svg>
        Failed
      </span>
    )}
  </div>
</div>
```

**Sidebar Indicators**:
```typescript
// ConversationItem
<div className={`flex items-center justify-between ... ${
  isPending ? 'opacity-70' : ''  // Dim pending conversations
}`}>
  <span className="truncate">{displayTitle}</span>

  {isPending && (
    <svg className="w-3 h-3 animate-spin text-blue-500" ...>...</svg>
  )}
</div>
```

### Error Handling and Recovery

**Automatic Retry Strategy**:
```typescript
async function sendMessageWithRetry(
  question: string,
  maxRetries: number = 3
): Promise<void> {
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await processQuery({
        query: question,
        session_id: sessionId
      });

      // Success - update UI
      confirmOptimisticMessage(optimisticId, response.message_id, response.response);
      return;

    } catch (error) {
      retryCount++;

      if (retryCount >= maxRetries) {
        // All retries failed - mark as failed
        failOptimisticMessage(optimisticId,
          'Failed to send message. Please try again.'
        );
        return;
      }

      // Exponential backoff
      await sleep(Math.pow(2, retryCount) * 1000);
    }
  }
}
```

**User Recovery Options**:
1. **Retry button**: Allow user to retry failed message
2. **Delete button**: Remove failed message from conversation
3. **Edit and resend**: Modify question and try again

**Recovery Implementation**:
```typescript
function handleRetryMessage(messageId: string) {
  const message = IdUtils.findById(currentConversation, messageId);
  if (!message) return;

  // Reset to loading state
  setCurrentConversation(prev => prev.map(item =>
    item.id === messageId
      ? { ...item, failed: false, loading: true }
      : item
  ));

  // Retry API call
  sendMessageWithRetry(message.question);
}
```

### Testing Strategies

**Unit Tests**:
```typescript
describe('OptimisticIdGenerator', () => {
  it('generates unique IDs', () => {
    const id1 = OptimisticIdGenerator.generate();
    const id2 = OptimisticIdGenerator.generate();
    expect(id1).not.toBe(id2);
  });

  it('identifies optimistic IDs', () => {
    const id = OptimisticIdGenerator.generate();
    expect(OptimisticIdGenerator.isOptimistic(id)).toBe(true);
    expect(OptimisticIdGenerator.isOptimistic('real-uuid')).toBe(false);
  });
});

describe('IdUtils', () => {
  it('finds message by optimistic ID', () => {
    const items = [
      { id: 'opt_123', pendingOperationId: 'opt_123', ... }
    ];
    const found = IdUtils.findById(items, 'opt_123');
    expect(found).toBeDefined();
  });

  it('reconciles optimistic ID to real ID', () => {
    const items = [
      { id: 'opt_123', ... }
    ];
    const reconciled = IdUtils.reconcileId(items, 'opt_123', 'real-uuid');
    expect(reconciled[0].id).toBe('real-uuid');
    expect(reconciled[0].originalId).toBe('opt_123');
  });
});
```

**Integration Tests**:
```typescript
describe('Optimistic message flow', () => {
  it('adds optimistic message immediately', async () => {
    const { getByText, getByPlaceholderText } = render(<SidePanelApp />);

    const input = getByPlaceholderText('Ask a question...');
    fireEvent.change(input, { target: { value: 'Test question' } });
    fireEvent.click(getByText('Send'));

    // Message should appear immediately
    expect(getByText('Test question')).toBeInTheDocument();
    expect(getByText('Thinking...')).toBeInTheDocument();
  });

  it('confirms message after API success', async () => {
    mockApiSuccess({ response: 'Test answer', message_id: 'real-123' });

    const { getByText, queryByText } = render(<SidePanelApp />);

    // Send message
    fireEvent.click(getByText('Send'));

    // Wait for API response
    await waitFor(() => {
      expect(getByText('Test answer')).toBeInTheDocument();
      expect(queryByText('Thinking...')).not.toBeInTheDocument();
    });
  });

  it('marks message as failed on API error', async () => {
    mockApiError(new Error('Network error'));

    const { getByText } = render(<SidePanelApp />);

    // Send message
    fireEvent.click(getByText('Send'));

    // Wait for error state
    await waitFor(() => {
      expect(getByText('Failed')).toBeInTheDocument();
    });
  });
});
```

**E2E Test Scenarios**:
1. Send message with network delay → verify immediate UI update
2. Send message with API failure → verify error indicator appears
3. Send multiple messages quickly → verify all tracked correctly
4. Browser refresh during pending operation → verify recovery on load
5. Navigate away and back → verify optimistic state persists

---

## Key Features

### Session Management

**Client-Based Persistence**:
- Unique `client_id` stored in browser localStorage
- Automatic session resumption across browser restarts
- Session timeout configurable (60-480 minutes)
- Recovery from browser crashes or forced closures

**Session Lifecycle**:
```
[User opens extension]
  ↓
[Check localStorage for client_id]
  ↓
[Create/Resume session with backend]
  ↓
[Store session_id in browser.storage]
  ↓
[User interacts with copilot]
  ↓
[Heartbeat every 5 minutes to keep session alive]
  ↓
[User closes browser]
  ↓
[Session remains active on backend for timeout period]
  ↓
[User reopens extension within timeout]
  ↓
[Session automatically resumed with same client_id]
```

**Session Recovery**:
```typescript
async function createSessionWithRecovery() {
  try {
    const response = await createSession({
      client_id: getOrCreateClientId(),
      session_type: 'troubleshooting',
      timeout_minutes: 180
    });

    if (response.session_resumed) {
      console.log('Session resumed:', response.session_id);
      // Load conversation history from storage
      await loadConversationsFromStorage();
    } else {
      console.log('New session created:', response.session_id);
    }

    return response;

  } catch (error) {
    if (isSessionExpiredError(error)) {
      // Session expired - clear client_id and create fresh session
      clearClientId();
      return await createSession({ /* ... */ });
    }
    throw error;
  }
}
```

### Knowledge Base Integration

**Document Upload**:
- Drag-and-drop file upload with visual feedback
- Supported formats: PDF, TXT, MD, JSON, YAML, logs
- File size limit: 10MB per document
- Progress indicators during upload and processing

**Document Processing**:
1. User uploads document
2. Backend extracts text content
3. Content chunked and embedded (BGE-M3 model)
4. Vectors stored in ChromaDB
5. Status updates: `uploading` → `processing` → `ready`

**Search and Retrieval**:
- Semantic search across all uploaded documents
- Relevance scoring with citation support
- Automatic source attribution in AI responses
- Document preview capability

### Page Content Capture

**Content Script**:
```typescript
// page-content.content.ts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPageContent') {
    try {
      const pageContent = document.documentElement.outerHTML;
      sendResponse({
        status: 'success',
        data: pageContent,
        url: window.location.href
      });
    } catch (error) {
      sendResponse({
        status: 'error',
        message: error.message
      });
    }
    return true;  // Keep channel open for async response
  }
});
```

**Usage in Copilot**:
```typescript
async function capturePageContent(): Promise<string> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  const response = await browser.tabs.sendMessage(tab.id, {
    action: 'getPageContent'
  });

  if (response.status === 'success') {
    return response.data;
  }
  throw new Error(response.message);
}
```

### Source Citations and References

**Inline Citation Format**:
```
The issue is caused by a memory leak [1]. You can fix it by updating
the configuration [2] or using the alternative approach [3].

Sources:
[1] "Memory Management Best Practices" - knowledge_base
[2] "Configuration Guide v2.1" - knowledge_base
[3] "Alternative Solutions" - web_search
```

**Citation Rendering**:
```typescript
function InlineSourcesRenderer({ content, sources }: Props) {
  const processedContent = content.replace(/\[(\d+)\]/g, (match, num) => {
    const index = parseInt(num) - 1;
    if (sources && sources[index]) {
      return `<a href="#source-${index}" class="citation">[${num}]</a>`;
    }
    return match;
  });

  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: processedContent }} />
      {sources && sources.length > 0 && (
        <div className="sources">
          {sources.map((source, index) => (
            <SourceCard key={source.id} source={source} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Source Card**:
- Title and excerpt
- Source type badge (KB, Web, Uploaded)
- Relevance score indicator
- Click to view full content
- Copy citation to clipboard

### Browser Compatibility

**Chrome (Manifest V3)**:
- Side panel API for persistent UI
- Service worker for background tasks
- Chrome storage API for persistence
- Scripting API for content scripts

**Firefox (Manifest V2 compatibility)**:
- Sidebar API (alternative to side panel)
- Background scripts (persistent)
- Browser storage API
- Content scripts with same capabilities

**Cross-Browser Build**:
```bash
pnpm build           # Chrome MV3
pnpm build:firefox   # Firefox with compatibility shims
```

**Compatibility Layer**:
```typescript
// Use browser namespace with chrome fallback
const browser = globalThis.browser || globalThis.chrome;

// Detect side panel support
const hasSidePanel = 'sidePanel' in browser;
const useAlternativeUI = !hasSidePanel;  // Use popup or sidebar
```

---

## Security and Privacy

### PII Redaction

All user-provided content (questions, page content, uploaded data) is sanitized through backend PII redaction service (Presidio) before being sent to LLM providers.

**Redacted Information**:
- Email addresses
- Phone numbers
- IP addresses
- Credit card numbers
- Social security numbers
- API keys and tokens
- Personal names (optional)

### Content Security Policy

**Extension Pages CSP**:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://api.faultmaven.ai http://api.faultmaven.local:8000;"
}
```

### Permissions

**Required Permissions**:
- `storage`: Persist auth and session state
- `sidePanel`: Display side panel UI
- `activeTab`: Access current tab for context
- `tabs`: Query tab information
- `scripting`: Inject content scripts

**Host Permissions**:
- `https://api.faultmaven.ai/*`: Production API
- `http://api.faultmaven.local:8000/*`: Development API

---

## Performance Considerations

### Bundle Size

**Production Build**:
- Total: ~2.0 MB uncompressed
- Main bundle: ~1.5 MB (React + dependencies)
- Assets: ~0.5 MB (icons, fonts)

**Optimization Strategies**:
- Code splitting by route (future enhancement)
- Lazy loading for Knowledge Base components
- Tree shaking for unused code
- Minification and compression

### Caching

**Browser Storage**:
- Conversations cached locally
- Auth state persisted
- Session ID stored for quick access
- Knowledge base document list cached

**API Response Caching**:
- Knowledge base documents cached for 5 minutes
- Session validation cached until expiration
- No caching for AI responses (always fresh)

### Rendering Performance

**React Optimization**:
- `React.memo()` for conversation items
- `useMemo()` for expensive computations
- `useCallback()` for stable callback references
- Virtual scrolling for long conversation lists (future)

**DOM Updates**:
- Batch state updates with `useState`
- Debounce rapid user input
- Throttle scroll event handlers
- Minimize re-renders with proper key props

---

## Accessibility

### WCAG 2.1 AA Compliance

**Keyboard Navigation**:
- Tab through all interactive elements
- Enter/Space to activate buttons
- Escape to close modals and menus
- Arrow keys for list navigation

**Screen Reader Support**:
- Semantic HTML elements
- ARIA labels for icon buttons
- ARIA live regions for dynamic content
- Focus management for modals

**Visual Accessibility**:
- Sufficient color contrast (4.5:1 minimum)
- Focus indicators on all interactive elements
- No reliance on color alone for information
- Resizable text (up to 200%)

**Example ARIA Implementation**:
```typescript
<button
  onClick={handleSend}
  aria-label="Send message"
  disabled={isLoading}
>
  <SendIcon />
</button>

<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  {isLoading && "Thinking..."}
</div>
```

---

## Build and Deployment

### Build Artifacts

**Chrome MV3**:
```
.output/chrome-mv3/
├── manifest.json
├── background.js
├── content-scripts/
│   └── page-content.js
├── sidepanel_manual.html
├── chunks/
│   └── sidepanel_manual-*.js
├── assets/
│   └── sidepanel_manual-*.css
└── icon/
    └── *.png
```

**Firefox**:
```
.output/firefox-mv2/
└── (similar structure with MV2 manifest)
```

### Distribution

**Chrome Web Store**:
```bash
pnpm zip          # Creates chrome-mv3.zip
# Upload to Chrome Web Store Developer Dashboard
```

**Firefox Add-ons**:
```bash
pnpm zip:firefox  # Creates firefox-mv2.zip
# Upload to Firefox Add-on Developer Hub
```

### Environment Configuration

**Development**:
```bash
VITE_API_URL=http://api.faultmaven.local:8000
NODE_ENV=development
```

**Production**:
```bash
VITE_API_URL=https://api.faultmaven.ai
NODE_ENV=production
```

---

## Testing

### Test Suite

**Current Coverage**: 19 tests passing

**Test Categories**:
1. Unit tests: Component logic, utilities, API client
2. Integration tests: Component interactions, data flow
3. Mock setup: Browser APIs, fetch, storage

**Test Configuration** (vitest.config.ts):
```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov']
    }
  }
});
```

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test --watch      # Watch mode
pnpm test:ui           # Interactive UI
pnpm test:coverage     # Generate coverage report
```

### Test Examples

**Component Test**:
```typescript
describe('ConversationItem', () => {
  it('renders conversation title', () => {
    const { getByText } = render(
      <ConversationItem
        session={{ id: '123', title: 'Test Chat' }}
        isActive={false}
        onSelect={() => {}}
      />
    );
    expect(getByText('Test Chat')).toBeInTheDocument();
  });
});
```

**API Test**:
```typescript
describe('createSession', () => {
  it('creates new session successfully', async () => {
    mockFetch({
      session_id: '123',
      status: 'active',
      session_resumed: false
    });

    const session = await createSession({
      client_id: 'client-123',
      session_type: 'troubleshooting'
    });

    expect(session.session_id).toBe('123');
    expect(session.session_resumed).toBe(false);
  });
});
```