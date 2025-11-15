# FaultMaven Copilot Migration Guide: Adaptive Multi-Mode Architecture

**Migration Goal:** Support multiple deployment modes with adaptive UI (self-hosted, enterprise cloud, enterprise self-host)

**Document Version:** 2.0
**Last Updated:** 2025-11-15
**Estimated Timeline:** 4-5 weeks

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Deployment Modes & Capability Matrix](#deployment-modes--capability-matrix)
3. [Architecture Overview](#architecture-overview)
4. [Backend: Capabilities Negotiation API](#backend-capabilities-negotiation-api)
5. [Extension: Adaptive UI Implementation](#extension-adaptive-ui-implementation)
6. [Dashboard: Web Application](#dashboard-web-application)
7. [Authentication & Security](#authentication--security)
8. [KB Ingestion Lifecycle](#kb-ingestion-lifecycle)
9. [Performance & Observability](#performance--observability)
10. [Deployment](#deployment)
11. [Testing Strategy](#testing-strategy)
12. [Rollout Plan](#rollout-plan)
13. [Failure Modes & Resilience](#failure-modes--resilience)
14. [Appendices](#appendices)

---

## Executive Summary

### The Challenge

FaultMaven is **open-source and supports multiple deployment modes**:
- **Community/Self-Hosted:** Users run backend locally
- **Enterprise Cloud:** Managed SaaS offering
- **Enterprise Self-Host:** Enterprise features with on-premise backend

**Previous approach** bundled all KB management into the extension (~850 KB), causing:
- Slow load times during incidents (400ms)
- Cramped UI in 300px side panel
- Same code for very different use cases

### The Solution: Adaptive Multi-Mode Architecture

**Single extension codebase** that adapts based on backend capabilities:

| Deployment Mode | Extension UI | Dashboard | Default Behavior |
|----------------|--------------|-----------|------------------|
| **Community/Self-Hosted** | Chat + KB tabs | Optional | Full-featured extension |
| **Enterprise Cloud** | Chat only | Required (hosted) | Lightweight extension + web dashboard |
| **Enterprise Self-Host** | Chat + optional KB | Optional (self-host) | Policy-driven configuration |

**Key Innovation:** Backend exposes `/v1/meta/capabilities` endpoint → Extension adapts UI automatically

### Benefits

| Metric | Before | After (Enterprise) | After (Self-Hosted) |
|--------|--------|-------------------|---------------------|
| Extension Bundle | 850 KB | 450 KB | 850 KB (unchanged) |
| Load Time | ~400ms | ~180ms | ~400ms (unchanged) |
| KB Management | Side panel | Full web app | Side panel (familiar) |
| Maintenance | Separate builds | Single codebase | Single codebase |

---

## Deployment Modes & Capability Matrix

### Mode 1: Community / Self-Hosted

**Target Users:** Individual developers, small teams, air-gapped environments

**Architecture:**
```
┌─────────────────────────────┐
│  Browser Extension          │
│  ├── Chat                  │
│  ├── KB Tabs (User)       │
│  └── Admin KB (if admin)  │
└─────────────────────────────┘
         ↓ API
┌─────────────────────────────┐
│  Local Backend              │
│  http://localhost:8000      │
└─────────────────────────────┘
```

**Capabilities:**
```json
{
  "deploymentMode": "self-hosted",
  "kbManagement": "extension",
  "dashboardUrl": null,
  "features": {
    "extensionKB": true,
    "adminKB": false,
    "caseHistory": false
  },
  "limits": {
    "maxFileBytes": 10485760,
    "allowedExtensions": [".md", ".txt", ".log", ".json", ".csv"]
  }
}
```

### Mode 2: Enterprise Cloud (SaaS)

**Target Users:** Enterprise subscribers, managed service customers

**Architecture:**
```
┌─────────────────────────────┐
│  Browser Extension          │
│  ├── Chat ONLY             │
│  └── "Open Dashboard" btn  │
│  Bundle: 450 KB            │
└─────────────────────────────┘
         ↓ API
┌─────────────────────────────┐
│  Hosted Backend             │
│  api.faultmaven.ai          │
└─────────────────────────────┘
         ↑ API
┌─────────────────────────────┐
│  Web Dashboard              │
│  app.faultmaven.ai          │
│  - KB Management            │
│  - Case History             │
│  - Analytics                │
└─────────────────────────────┘
```

**Capabilities:**
```json
{
  "deploymentMode": "enterprise",
  "kbManagement": "dashboard",
  "dashboardUrl": "https://app.faultmaven.ai",
  "features": {
    "extensionKB": false,
    "adminKB": true,
    "caseHistory": true,
    "teamWorkspaces": true
  },
  "limits": {
    "maxFileBytes": 52428800,
    "allowedExtensions": [".md", ".txt", ".log", ".json", ".csv", ".pdf", ".doc", ".docx"]
  }
}
```

### Mode 3: Enterprise Self-Host

**Target Users:** Enterprises with on-premise requirements, data residency needs

**Architecture:**
```
┌─────────────────────────────┐
│  Browser Extension          │
│  ├── Chat                  │
│  ├── KB (policy-driven)   │
│  └── Dashboard link        │
└─────────────────────────────┘
         ↓ API
┌─────────────────────────────┐
│  On-Premise Backend         │
│  api.company.internal       │
└─────────────────────────────┘
         ↑ API
┌─────────────────────────────┐
│  Self-Hosted Dashboard      │
│  faultmaven.company.internal│
│  (Docker / k8s)             │
└─────────────────────────────┘
```

**Capabilities:**
```json
{
  "deploymentMode": "enterprise-selfhost",
  "kbManagement": "both",
  "dashboardUrl": "https://faultmaven.company.internal",
  "features": {
    "extensionKB": true,
    "adminKB": true,
    "caseHistory": true,
    "teamWorkspaces": true,
    "ssoRequired": true
  },
  "limits": {
    "maxFileBytes": 104857600,
    "allowedExtensions": [".md", ".txt", ".log", ".json", ".csv", ".pdf", ".doc", ".docx", ".yaml", ".xml"]
  },
  "policy": {
    "enforceKBViaExtension": false,
    "allowExtensionKB": true
  }
}
```

---

## Backend: Capabilities Negotiation API

### Endpoint Specification

**GET `/v1/meta/capabilities`**

**Description:** Returns deployment capabilities and configuration for client adaptation

**Authentication:** Optional (public endpoint for feature discovery)

**Response Schema:**
```typescript
interface CapabilitiesResponse {
  deploymentMode: 'self-hosted' | 'enterprise' | 'enterprise-selfhost';
  kbManagement: 'extension' | 'dashboard' | 'both';
  dashboardUrl: string | null;
  features: {
    extensionKB: boolean;
    adminKB: boolean;
    caseHistory: boolean;
    teamWorkspaces?: boolean;
    ssoRequired?: boolean;
  };
  limits: {
    maxFileBytes: number;
    allowedExtensions: string[];
    maxDocuments?: number;
  };
  policy?: {
    enforceKBViaExtension?: boolean;
    allowExtensionKB?: boolean;
  };
  branding?: {
    name: string;
    logoUrl?: string;
    supportUrl?: string;
  };
}
```

### Backend Implementation (FastAPI)

**File: `backend/api/v1/meta.py`**

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, List
from ..config import settings

router = APIRouter(prefix="/v1/meta", tags=["meta"])

class Features(BaseModel):
    extensionKB: bool
    adminKB: bool
    caseHistory: bool
    teamWorkspaces: Optional[bool] = False
    ssoRequired: Optional[bool] = False

class Limits(BaseModel):
    maxFileBytes: int
    allowedExtensions: List[str]
    maxDocuments: Optional[int] = None

class Policy(BaseModel):
    enforceKBViaExtension: Optional[bool] = False
    allowExtensionKB: Optional[bool] = True

class Branding(BaseModel):
    name: str
    logoUrl: Optional[str] = None
    supportUrl: Optional[str] = None

class CapabilitiesResponse(BaseModel):
    deploymentMode: str
    kbManagement: str
    dashboardUrl: Optional[str]
    features: Features
    limits: Limits
    policy: Optional[Policy] = None
    branding: Optional[Branding] = None

@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities():
    """
    Returns deployment capabilities for client adaptation.

    This endpoint is public and does not require authentication,
    allowing clients to discover features before login.
    """

    # Determine deployment mode from settings
    if settings.DEPLOYMENT_MODE == "enterprise":
        return CapabilitiesResponse(
            deploymentMode="enterprise",
            kbManagement="dashboard",
            dashboardUrl=settings.DASHBOARD_URL or "https://app.faultmaven.ai",
            features=Features(
                extensionKB=False,
                adminKB=True,
                caseHistory=True,
                teamWorkspaces=True,
                ssoRequired=False
            ),
            limits=Limits(
                maxFileBytes=52428800,  # 50 MB
                allowedExtensions=[".md", ".txt", ".log", ".json", ".csv", ".pdf", ".doc", ".docx"],
                maxDocuments=10000
            ),
            branding=Branding(
                name="FaultMaven",
                supportUrl="https://support.faultmaven.ai"
            )
        )
    else:
        # Self-hosted mode (default)
        return CapabilitiesResponse(
            deploymentMode="self-hosted",
            kbManagement="extension",
            dashboardUrl=None,
            features=Features(
                extensionKB=True,
                adminKB=False,
                caseHistory=False,
                teamWorkspaces=False
            ),
            limits=Limits(
                maxFileBytes=10485760,  # 10 MB
                allowedExtensions=[".md", ".txt", ".log", ".json", ".csv"]
            ),
            branding=Branding(
                name="FaultMaven (Self-Hosted)",
                supportUrl="https://docs.faultmaven.ai"
            )
        )
```

**Configuration File: `backend/config.py`**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Deployment configuration
    DEPLOYMENT_MODE: str = "self-hosted"  # "self-hosted" | "enterprise" | "enterprise-selfhost"
    DASHBOARD_URL: str | None = None

    # KB limits
    MAX_UPLOAD_SIZE_MB: int = 10
    ALLOWED_FILE_EXTENSIONS: list[str] = [".md", ".txt", ".log", ".json", ".csv"]

    # Features toggles
    ENABLE_ADMIN_KB: bool = False
    ENABLE_CASE_HISTORY: bool = False
    ENABLE_TEAM_WORKSPACES: bool = False

    class Config:
        env_file = ".env"

settings = Settings()
```

---

## Extension: Adaptive UI Implementation

### Client Boot Flow

**File: `src/lib/capabilities.ts`**

```typescript
export interface BackendCapabilities {
  deploymentMode: 'self-hosted' | 'enterprise' | 'enterprise-selfhost';
  kbManagement: 'extension' | 'dashboard' | 'both';
  dashboardUrl: string | null;
  features: {
    extensionKB: boolean;
    adminKB: boolean;
    caseHistory: boolean;
    teamWorkspaces?: boolean;
    ssoRequired?: boolean;
  };
  limits: {
    maxFileBytes: number;
    allowedExtensions: string[];
    maxDocuments?: number;
  };
  policy?: {
    enforceKBViaExtension?: boolean;
    allowExtensionKB?: boolean;
  };
  branding?: {
    name: string;
    logoUrl?: string;
    supportUrl?: string;
  };
}

class CapabilitiesManager {
  private capabilities: BackendCapabilities | null = null;
  private fetchPromise: Promise<BackendCapabilities> | null = null;

  async fetch(apiUrl: string): Promise<BackendCapabilities> {
    // Return cached if available
    if (this.capabilities) {
      return this.capabilities;
    }

    // Prevent duplicate requests
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        const response = await fetch(`${apiUrl}/v1/meta/capabilities`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`Capabilities fetch failed: ${response.status}`);
        }

        const caps = await response.json();
        this.capabilities = caps;

        // Cache in browser storage for offline access
        if (typeof browser !== 'undefined' && browser.storage) {
          await browser.storage.local.set({ backendCapabilities: caps });
        }

        console.log('[CapabilitiesManager] Fetched capabilities:', caps.deploymentMode);
        return caps;

      } catch (error) {
        console.warn('[CapabilitiesManager] Failed to fetch capabilities, using defaults:', error);

        // Fallback: Try to load from cache
        if (typeof browser !== 'undefined' && browser.storage) {
          const cached = await browser.storage.local.get(['backendCapabilities']);
          if (cached.backendCapabilities) {
            this.capabilities = cached.backendCapabilities;
            return this.capabilities;
          }
        }

        // Final fallback: assume self-hosted
        const fallback: BackendCapabilities = {
          deploymentMode: 'self-hosted',
          kbManagement: 'extension',
          dashboardUrl: null,
          features: {
            extensionKB: true,
            adminKB: false,
            caseHistory: false
          },
          limits: {
            maxFileBytes: 10485760,
            allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv']
          }
        };

        this.capabilities = fallback;
        return fallback;
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  getCapabilities(): BackendCapabilities | null {
    return this.capabilities;
  }

  shouldShowExtensionKB(): boolean {
    if (!this.capabilities) return true; // Default to showing KB
    return this.capabilities.features.extensionKB;
  }

  shouldShowDashboardLink(): boolean {
    if (!this.capabilities) return false;
    return this.capabilities.kbManagement === 'dashboard' ||
           this.capabilities.kbManagement === 'both';
  }

  getDashboardUrl(): string | null {
    return this.capabilities?.dashboardUrl ?? null;
  }

  getUploadLimits() {
    return this.capabilities?.limits ?? {
      maxFileBytes: 10485760,
      allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv']
    };
  }
}

export const capabilitiesManager = new CapabilitiesManager();
```

### Adaptive UI in SidePanelApp

**File: `src/shared/ui/SidePanelApp.tsx`**

```typescript
import { capabilitiesManager } from '../../lib/capabilities';

function SidePanelAppContent() {
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  // Fetch capabilities on mount
  useEffect(() => {
    const loadCapabilities = async () => {
      try {
        const apiUrl = config.apiUrl;
        const caps = await capabilitiesManager.fetch(apiUrl);
        setCapabilities(caps);
        setCapabilitiesLoaded(true);

        console.log('[SidePanelApp] Deployment mode:', caps.deploymentMode);
        console.log('[SidePanelApp] KB management:', caps.kbManagement);
      } catch (error) {
        console.error('[SidePanelApp] Failed to load capabilities:', error);
        setCapabilitiesLoaded(true); // Still render with defaults
      }
    };

    loadCapabilities();
  }, []);

  // Determine which tabs to show
  const showKBTab = capabilities?.features.extensionKB ?? true;
  const showAdminKBTab = capabilities?.features.adminKB && isAdmin();
  const showDashboardButton = capabilities?.dashboardUrl != null;

  // Show loading state while fetching capabilities
  if (!capabilitiesLoaded) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-gray-600">Loading...</div>
    </div>;
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50">
        <CollapsibleNavigation
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          activeTab={activeTab}
          activeCaseId={activeCaseId}
          // Pass capability flags
          showKBTab={showKBTab}
          showAdminKBTab={showAdminKBTab}
          showDashboardButton={showDashboardButton}
          dashboardUrl={capabilities?.dashboardUrl}
          // ... other props
        />

        <ContentArea
          activeTab={activeTab}
          showKBTab={showKBTab}
          // ... other props
        />
      </div>
    </ErrorBoundary>
  );
}
```

### Dynamic Module Loading (Code Splitting)

**File: `src/shared/ui/layouts/ContentArea.tsx`**

```typescript
import React, { lazy, Suspense } from 'react';

// Lazy load KB components only when needed
const KnowledgeBaseView = lazy(() => import('../KnowledgeBaseView'));
const GlobalKBView = lazy(() => import('../GlobalKBView'));

interface ContentAreaProps {
  activeTab: 'copilot' | 'kb' | 'admin-kb';
  showKBTab: boolean;
  // ... other props
}

export function ContentArea({ activeTab, showKBTab, ...props }: ContentAreaProps) {
  return (
    <main className="flex-1 overflow-hidden">
      {activeTab === 'copilot' && (
        <ChatWindow {...props} />
      )}

      {activeTab === 'kb' && showKBTab && (
        <Suspense fallback={<div className="p-4">Loading KB...</div>}>
          <KnowledgeBaseView />
        </Suspense>
      )}

      {activeTab === 'admin-kb' && showKBTab && (
        <Suspense fallback={<div className="p-4">Loading Admin KB...</div>}>
          <GlobalKBView />
        </Suspense>
      )}
    </main>
  );
}
```

**Benefits of Code Splitting:**
- KB components only loaded when tab is activated
- Enterprise users (no KB) never download KB code → smaller bundle
- Self-hosted users download KB code on-demand → fast initial load

---

## Authentication & Security

### Authentication Flows

#### 1. Development (devLogin) - LOCAL/DEV ONLY

**⚠️ WARNING:** `devLogin` is for development only. DO NOT use in production.

```typescript
// File: src/lib/api.ts
export async function devLogin(username: string) {
  // ONLY for local development and testing
  if (config.apiUrl.includes('localhost') || config.apiUrl.includes('127.0.0.1')) {
    const response = await fetch(`${config.apiUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    return response.json();
  } else {
    throw new Error('devLogin is disabled in production');
  }
}
```

#### 2. OAuth2 / PKCE (Production)

**For Enterprise Cloud:**

```typescript
// File: src/lib/auth/oauth.ts
import { browser } from 'wxt/browser';

const OAUTH_CONFIG = {
  authorizationEndpoint: 'https://auth.faultmaven.ai/oauth/authorize',
  tokenEndpoint: 'https://auth.faultmaven.ai/oauth/token',
  clientId: 'faultmaven-extension',
  redirectUri: browser.identity.getRedirectURL('oauth'),
  scopes: ['kb:read', 'kb:write', 'cases:read', 'cases:write']
};

// Generate PKCE challenge
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

export async function initiateOAuth(): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store verifier for later
  await browser.storage.local.set({ oauth_code_verifier: codeVerifier });

  const authUrl = new URL(OAUTH_CONFIG.authorizationEndpoint);
  authUrl.searchParams.set('client_id', OAUTH_CONFIG.clientId);
  authUrl.searchParams.set('redirect_uri', OAUTH_CONFIG.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', OAUTH_CONFIG.scopes.join(' '));
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Launch auth flow
  const redirectUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  // Extract authorization code from redirect
  const url = new URL(redirectUrl);
  const code = url.searchParams.get('code');

  if (!code) {
    throw new Error('Authorization code not received');
  }

  return code;
}

export async function exchangeCodeForToken(authCode: string): Promise<AuthTokens> {
  const { oauth_code_verifier } = await browser.storage.local.get(['oauth_code_verifier']);

  const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      client_id: OAUTH_CONFIG.clientId,
      code_verifier: oauth_code_verifier
    })
  });

  const tokens = await response.json();

  // Store tokens securely
  await browser.storage.local.set({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: Date.now() + (tokens.expires_in * 1000)
  });

  return tokens;
}
```

#### 3. SSO (Enterprise Self-Host)

**SAML / OIDC Integration:**

```typescript
// File: src/lib/auth/sso.ts

export async function initiateSSOLogin(idpHint?: string): Promise<void> {
  const caps = capabilitiesManager.getCapabilities();

  if (caps?.features.ssoRequired) {
    const ssoUrl = `${config.apiUrl}/api/v1/auth/sso/login`;
    const params = new URLSearchParams({
      redirect_uri: browser.identity.getRedirectURL('sso'),
      idp_hint: idpHint || ''
    });

    const redirectUrl = await browser.identity.launchWebAuthFlow({
      url: `${ssoUrl}?${params}`,
      interactive: true
    });

    // Extract session token from redirect
    const url = new URL(redirectUrl);
    const token = url.searchParams.get('token');

    if (token) {
      await browser.storage.local.set({ access_token: token });
    }
  } else {
    throw new Error('SSO not configured for this deployment');
  }
}
```

### Token Storage & Management

**Extension (browser.storage.local):**
```typescript
// Store
await browser.storage.local.set({
  access_token: token,
  refresh_token: refreshToken,
  token_expires_at: expiresAt
});

// Retrieve
const { access_token } = await browser.storage.local.get(['access_token']);

// Clear on logout
await browser.storage.local.remove(['access_token', 'refresh_token', 'token_expires_at']);
```

**Dashboard (localStorage with encryption):**
```typescript
// Store (consider encryption for sensitive tokens)
localStorage.setItem('faultmaven_auth_token', token);
localStorage.setItem('faultmaven_refresh_token', refreshToken);
localStorage.setItem('faultmaven_token_expires_at', expiresAt.toString());

// Retrieve
const token = localStorage.getItem('faultmaven_auth_token');

// Clear on logout
localStorage.removeItem('faultmaven_auth_token');
localStorage.removeItem('faultmaven_refresh_token');
localStorage.removeItem('faultmaven_token_expires_at');
```

### Security Checklist

#### Extension Security
- [ ] Manifest V3 compliance
- [ ] Minimal `host_permissions` (only API domains)
- [ ] `activeTab` instead of `tabs` permission where possible
- [ ] No `eval()` or inline scripts
- [ ] Content Security Policy enforced
- [ ] Token stored in `browser.storage.local` (encrypted by browser)
- [ ] HTTPS-only API communication

**Manifest Permissions Review:**
```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    permissions: [
      'storage',        // Store auth tokens and settings
      'sidePanel',      // Side panel UI
      'activeTab',      // Read active tab URL (not all tabs)
      'scripting',      // Inject content scripts on demand
    ],
    host_permissions: [
      'https://api.faultmaven.ai/*',      // Production API
      'https://app.faultmaven.ai/*',      // Dashboard (for opening)
      'http://localhost:8000/*',          // Dev API
      'http://localhost:5173/*',          // Dev dashboard
    ],
    // Remove unused permissions from v0.3.x
    // 'tabs' - replaced with 'activeTab'
  }
});
```

#### Dashboard Security
- [ ] Content Security Policy (CSP) headers
- [ ] No `eval()` or `Function()` constructors
- [ ] Trusted Types for DOM manipulation
- [ ] HTTPS-only (enforce via Vercel/nginx)
- [ ] SameSite cookies for session management
- [ ] CSRF protection on mutations
- [ ] XSS prevention (DOMPurify for user content)

**CSP Configuration (Vercel `vercel.json`):**
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.faultmaven.ai; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "geolocation=(), microphone=(), camera=()"
        }
      ]
    }
  ]
}
```

#### Data Residency & Compliance
- [ ] Document data storage regions (US, EU, etc.)
- [ ] PII redaction in logs
- [ ] Data retention policies documented
- [ ] GDPR compliance (right to deletion, export)
- [ ] SOC 2 / ISO 27001 controls (if enterprise)

---

## KB Ingestion Lifecycle

### Upload Flow

```
┌──────────────┐
│ User selects │
│    file      │
└──────┬───────┘
       │
       ├─── Pre-Upload Validation (Client)
       │    ├─ File size check (<maxFileBytes)
       │    ├─ Extension whitelist
       │    ├─ MIME type verification
       │    └─ Duplicate title check
       │
       ├─── Upload Request (multipart/form-data)
       │    POST /api/v1/kb/documents
       │    ├─ Chunked transfer (large files)
       │    └─ Progress updates via XHR events
       │
       ├─── Backend Processing
       │    ├─ Virus scan (ClamAV / VirusTotal API)
       │    ├─ File type detection (libmagic)
       │    ├─ Text extraction
       │    │   ├─ PDF: pdfplumber / PyMuPDF
       │    │   ├─ DOCX: python-docx
       │    │   ├─ Markdown/TXT: direct read
       │    │   └─ OCR: tesseract (if image-based PDF)
       │    ├─ Chunking (langchain text splitters)
       │    ├─ Embedding generation (async)
       │    └─ Vector DB storage (Qdrant / Pinecone)
       │
       └─── User Feedback
            ├─ Upload complete (201 Created)
            ├─ "Document uploaded. Indexing in progress..."
            ├─ Polling /api/v1/kb/documents/{id}/status
            └─ "✓ Indexed and ready (ETA: ~1-2 min)"
```

### Pre-Upload Validation (Client)

**File: `src/lib/kb-validation.ts`**

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export async function validateUpload(
  file: File,
  capabilities: BackendCapabilities
): Promise<ValidationResult> {
  const limits = capabilities.limits;
  const warnings: string[] = [];

  // 1. File size check
  if (file.size > limits.maxFileBytes) {
    const maxMB = (limits.maxFileBytes / 1048576).toFixed(0);
    return {
      valid: false,
      error: `File too large (${(file.size / 1048576).toFixed(1)} MB). Maximum: ${maxMB} MB`
    };
  }

  // 2. Extension check
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!limits.allowedExtensions.includes(extension)) {
    return {
      valid: false,
      error: `File type ${extension} not allowed. Supported: ${limits.allowedExtensions.join(', ')}`
    };
  }

  // 3. MIME type verification
  const expectedMimeTypes: Record<string, string[]> = {
    '.pdf': ['application/pdf'],
    '.md': ['text/markdown', 'text/plain'],
    '.txt': ['text/plain'],
    '.json': ['application/json'],
    '.csv': ['text/csv'],
    '.doc': ['application/msword'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  };

  const allowedMimeTypes = expectedMimeTypes[extension] || [];
  if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.type)) {
    warnings.push(`MIME type mismatch: expected ${allowedMimeTypes.join(' or ')}, got ${file.type}`);
  }

  // 4. Empty file check
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty'
    };
  }

  return { valid: true, warnings };
}

export async function checkDuplicates(
  title: string,
  documentType: string
): Promise<boolean> {
  // Query backend for existing documents with same title + type
  const response = await fetch(
    `${config.apiUrl}/api/v1/kb/documents?title=${encodeURIComponent(title)}&type=${documentType}&limit=1`
  );
  const data = await response.json();
  return data.total_count > 0;
}
```

### Upload Progress UI

**File: `src/shared/ui/components/UploadPanel.tsx`**

```typescript
interface UploadProgress {
  file: File;
  progress: number;  // 0-100
  status: 'uploading' | 'processing' | 'indexing' | 'complete' | 'error';
  message: string;
  documentId?: string;
}

export function UploadPanel() {
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});

  const handleUpload = async (file: File) => {
    const uploadId = `upload_${Date.now()}`;

    setUploads(prev => ({
      ...prev,
      [uploadId]: {
        file,
        progress: 0,
        status: 'uploading',
        message: 'Uploading...'
      }
    }));

    try {
      // Upload with progress tracking
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name);
      formData.append('document_type', 'runbook');

      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploads(prev => ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              progress,
              message: `Uploading ${progress}%`
            }
          }));
        }
      });

      // Handle completion
      xhr.addEventListener('load', async () => {
        if (xhr.status === 201) {
          const response = JSON.parse(xhr.responseText);

          setUploads(prev => ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              progress: 100,
              status: 'processing',
              message: 'Processing document...',
              documentId: response.document_id
            }
          }));

          // Poll for indexing status
          await pollIndexingStatus(uploadId, response.document_id);
        } else {
          throw new Error(`Upload failed: ${xhr.status}`);
        }
      });

      xhr.open('POST', `${config.apiUrl}/api/v1/kb/documents`);
      xhr.setRequestHeader('Authorization', `Bearer ${await getAuthToken()}`);
      xhr.send(formData);

    } catch (error) {
      setUploads(prev => ({
        ...prev,
        [uploadId]: {
          ...prev[uploadId],
          status: 'error',
          message: error.message
        }
      }));
    }
  };

  const pollIndexingStatus = async (uploadId: string, documentId: string) => {
    const maxPolls = 60; // 2 minutes max
    let polls = 0;

    const poll = async () => {
      if (polls++ >= maxPolls) {
        setUploads(prev => ({
          ...prev,
          [uploadId]: {
            ...prev[uploadId],
            status: 'complete',
            message: 'Upload complete (indexing may still be in progress)'
          }
        }));
        return;
      }

      try {
        const response = await fetch(
          `${config.apiUrl}/api/v1/kb/documents/${documentId}/status`
        );
        const status = await response.json();

        if (status.indexing_status === 'complete') {
          setUploads(prev => ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              status: 'complete',
              message: '✓ Indexed and ready for RAG'
            }
          }));
        } else if (status.indexing_status === 'failed') {
          throw new Error(status.error || 'Indexing failed');
        } else {
          // Still indexing
          setUploads(prev => ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              status: 'indexing',
              message: `Indexing... (${status.progress || 0}%)`
            }
          }));

          // Poll again in 2 seconds
          setTimeout(poll, 2000);
        }
      } catch (error) {
        setUploads(prev => ({
          ...prev,
          [uploadId]: {
            ...prev[uploadId],
            status: 'error',
            message: error.message
          }
        }));
      }
    };

    await poll();
  };

  return (
    <div className="space-y-4">
      {/* Upload UI */}
      <DropZone onDrop={handleUpload} />

      {/* Progress indicators */}
      {Object.entries(uploads).map(([id, upload]) => (
        <div key={id} className="border rounded p-3">
          <div className="flex justify-between mb-1">
            <span className="text-sm font-medium">{upload.file.name}</span>
            <span className="text-xs text-gray-500">{upload.message}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                upload.status === 'complete' ? 'bg-green-500' :
                upload.status === 'error' ? 'bg-red-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${upload.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Backend Indexing Status Endpoint

**File: `backend/api/v1/kb.py`**

```python
@router.get("/documents/{document_id}/status")
async def get_document_indexing_status(
    document_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Returns indexing status for a document.

    Clients should poll this endpoint after upload to track indexing progress.
    """
    doc = await get_document(document_id, current_user)

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return {
        "document_id": document_id,
        "indexing_status": doc.indexing_status,  # "pending" | "processing" | "complete" | "failed"
        "progress": doc.indexing_progress,  # 0-100
        "error": doc.indexing_error,
        "indexed_at": doc.indexed_at,
        "estimated_completion": calculate_eta(doc) if doc.indexing_status == "processing" else None
    }
```

---

## Performance & Observability

### Performance Budgets

**Enforced in CI:**

**File: `.github/workflows/performance-check.yml`**

```yaml
name: Performance Checks

on: [pull_request]

jobs:
  bundle-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build

      # Check extension bundle size
      - name: Check Extension Bundle Size
        run: |
          BUNDLE_SIZE=$(du -sb .output/chrome-mv3 | cut -f1)
          MAX_SIZE=524288000  # 500 KB = 500 * 1024 bytes

          if [ $BUNDLE_SIZE -gt $MAX_SIZE ]; then
            echo "❌ Bundle size ($BUNDLE_SIZE bytes) exceeds limit ($MAX_SIZE bytes)"
            exit 1
          else
            echo "✓ Bundle size OK: $BUNDLE_SIZE bytes"
          fi

      # Analyze bundle composition
      - run: npm install -g source-map-explorer
      - run: source-map-explorer '.output/chrome-mv3/**/*.js' --html bundle-report.html

      - uses: actions/upload-artifact@v3
        with:
          name: bundle-report
          path: bundle-report.html

  dashboard-performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3

      - run: cd faultmaven-dashboard && pnpm install
      - run: cd faultmaven-dashboard && pnpm build

      # Lighthouse CI
      - run: npm install -g @lhci/cli
      - run: lhci autorun --config=lighthouserc.json

      # Check TTI (Time to Interactive)
      - name: Check TTI Budget
        run: |
          TTI=$(jq '.[] | select(.category=="performance") | .audits["interactive"].numericValue' lhci-report.json)
          MAX_TTI=2000  # 2 seconds

          if (( $(echo "$TTI > $MAX_TTI" | bc -l) )); then
            echo "❌ TTI ($TTI ms) exceeds budget ($MAX_TTI ms)"
            exit 1
          else
            echo "✓ TTI OK: $TTI ms"
          fi
```

**Lighthouse Configuration:**

**File: `faultmaven-dashboard/lighthouserc.json`**

```json
{
  "ci": {
    "collect": {
      "startServerCommand": "npm run preview",
      "url": ["http://localhost:4173/kb"],
      "numberOfRuns": 3
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", {"minScore": 0.9}],
        "categories:accessibility": ["error", {"minScore": 0.95}],
        "first-contentful-paint": ["error", {"maxNumericValue": 1500}],
        "interactive": ["error", {"maxNumericValue": 2000}],
        "speed-index": ["error", {"maxNumericValue": 2500}],
        "total-blocking-time": ["error", {"maxNumericValue": 200}],
        "cumulative-layout-shift": ["error", {"maxNumericValue": 0.1}]
      }
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

### Observability Stack

#### Frontend (Extension + Dashboard)

**Sentry Integration:**

```typescript
// File: src/lib/monitoring/sentry.ts
import * as Sentry from "@sentry/browser";

export function initSentry() {
  const environment = config.apiUrl.includes('localhost') ? 'development' : 'production';

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment,
    release: `faultmaven-copilot@${import.meta.env.VITE_APP_VERSION}`,

    // Performance monitoring
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,

    // Session replay (dashboard only, not extension for privacy)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    beforeSend(event, hint) {
      // Redact PII
      if (event.request?.headers) {
        delete event.request.headers['Authorization'];
      }
      return event;
    }
  });
}

// Custom event tracking
export function trackEvent(
  category: string,
  action: string,
  label?: string,
  value?: number
) {
  Sentry.addBreadcrumb({
    category,
    message: `${action}${label ? `: ${label}` : ''}`,
    level: 'info',
    data: { value }
  });
}
```

**Event Taxonomy:**

```typescript
// KB events
trackEvent('kb', 'document_upload_start', documentType);
trackEvent('kb', 'document_upload_complete', documentId);
trackEvent('kb', 'document_index_complete', documentId, indexingTimeMs);
trackEvent('kb', 'document_search', query, resultsCount);
trackEvent('kb', 'document_view', documentId);

// Chat events
trackEvent('chat', 'query_submit', caseId);
trackEvent('chat', 'response_received', caseId, responseTimeMs);
trackEvent('chat', 'data_upload', dataType);
trackEvent('chat', 'case_created', caseId);

// Navigation events
trackEvent('navigation', 'tab_change', tab);
trackEvent('navigation', 'dashboard_open');
```

#### Backend (API)

**OpenTelemetry Integration:**

```python
# File: backend/observability/tracing.py
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

def setup_tracing(app):
    trace.set_tracer_provider(TracerProvider())
    tracer = trace.get_tracer(__name__)

    # Export to collector (Jaeger / Honeycomb / DataDog)
    otlp_exporter = OTLPSpanExporter(
        endpoint="https://otel-collector.faultmaven.ai:4317"
    )
    span_processor = BatchSpanProcessor(otlp_exporter)
    trace.get_tracer_provider().add_span_processor(span_processor)

    # Auto-instrument FastAPI
    FastAPIInstrumentor.instrument_app(app)

    return tracer

# Usage in endpoints
@router.post("/kb/documents")
async def upload_document(...):
    with tracer.start_as_current_span("kb.upload_document") as span:
        span.set_attribute("document.type", document_type)
        span.set_attribute("document.size_bytes", file.size)

        # Processing...

        span.set_attribute("indexing.duration_ms", duration)
        return response
```

### Kill Switch / Feature Flags

**Remote Config for Emergency Disables:**

```typescript
// File: src/lib/feature-flags.ts
interface RemoteConfig {
  killSwitches: {
    disableDashboardLink: boolean;
    disableKBUpload: boolean;
    disableChatSubmit: boolean;
  };
  maintenanceMode: {
    enabled: boolean;
    message: string;
  };
}

class FeatureFlagManager {
  private config: RemoteConfig | null = null;

  async fetchConfig(): Promise<RemoteConfig> {
    try {
      const response = await fetch(
        `${config.apiUrl}/v1/meta/feature-flags`,
        { cache: 'no-store' }
      );
      this.config = await response.json();
      return this.config;
    } catch (error) {
      console.warn('[FeatureFlags] Failed to fetch, using defaults');
      return {
        killSwitches: {
          disableDashboardLink: false,
          disableKBUpload: false,
          disableChatSubmit: false
        },
        maintenanceMode: { enabled: false, message: '' }
      };
    }
  }

  shouldShowDashboardLink(): boolean {
    return !this.config?.killSwitches.disableDashboardLink;
  }

  shouldAllowKBUpload(): boolean {
    return !this.config?.killSwitches.disableKBUpload;
  }

  isInMaintenanceMode(): boolean {
    return this.config?.maintenanceMode.enabled ?? false;
  }

  getMaintenanceMessage(): string {
    return this.config?.maintenanceMode.message ?? 'Service temporarily unavailable';
  }
}

export const featureFlagManager = new FeatureFlagManager();
```

**Usage in UI:**

```typescript
// Periodically refresh feature flags
useEffect(() => {
  const refreshFlags = async () => {
    await featureFlagManager.fetchConfig();
  };

  refreshFlags();
  const interval = setInterval(refreshFlags, 60000); // Every minute

  return () => clearInterval(interval);
}, []);

// Conditionally render dashboard button
{featureFlagManager.shouldShowDashboardLink() && (
  <button onClick={openDashboard}>Manage KB</button>
)}

// Show maintenance banner
{featureFlagManager.isInMaintenanceMode() && (
  <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4">
    <p>{featureFlagManager.getMaintenanceMessage()}</p>
  </div>
)}
```

---

## Deployment

### Self-Hosting the Dashboard

#### Option 1: Docker

**File: `faultmaven-dashboard/Dockerfile`**

```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Production stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

**File: `faultmaven-dashboard/nginx.conf`**

```nginx
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    server {
        listen 80;
        server_name _;

        root /usr/share/nginx/html;
        index index.html;

        # SPA routing - serve index.html for all routes
        location / {
            try_files $uri $uri/ /index.html;
        }

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # Security headers
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # CSP header
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.faultmaven.ai; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;

        # API proxy (optional - if backend on same host)
        location /api/ {
            proxy_pass http://backend:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

**Build and Run:**

```bash
# Build image
docker build -t faultmaven-dashboard:latest .

# Run container
docker run -d \
  --name faultmaven-dashboard \
  -p 3000:80 \
  -e VITE_API_URL=https://api.company.internal \
  faultmaven-dashboard:latest
```

#### Option 2: Docker Compose (Dashboard + Backend)

**File: `docker-compose.yml`**

```yaml
version: '3.8'

services:
  backend:
    image: faultmaven/backend:latest
    container_name: faultmaven-backend
    ports:
      - "8000:8000"
    environment:
      - DEPLOYMENT_MODE=enterprise-selfhost
      - DASHBOARD_URL=http://localhost:3000
      - DATABASE_URL=postgresql://user:pass@db:5432/faultmaven
    depends_on:
      - db
      - redis
    volumes:
      - ./data/uploads:/app/uploads
    networks:
      - faultmaven

  dashboard:
    build:
      context: ./faultmaven-dashboard
      dockerfile: Dockerfile
    container_name: faultmaven-dashboard
    ports:
      - "3000:80"
    environment:
      - VITE_API_URL=http://localhost:8000
    networks:
      - faultmaven

  db:
    image: postgres:15-alpine
    container_name: faultmaven-db
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: faultmaven
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - faultmaven

  redis:
    image: redis:7-alpine
    container_name: faultmaven-redis
    networks:
      - faultmaven

  vector-db:
    image: qdrant/qdrant:latest
    container_name: faultmaven-vectordb
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - faultmaven

volumes:
  postgres_data:
  qdrant_data:

networks:
  faultmaven:
    driver: bridge
```

**Start Services:**

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Vercel Deployment (Enterprise Cloud)

**Already covered in original guide, but adding:**

**File: `faultmaven-dashboard/vercel.json`**

```json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.faultmaven.ai; frame-ancestors 'none';"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ],
  "env": {
    "VITE_API_URL": "@vite_api_url",
    "VITE_MAX_FILE_SIZE_MB": "50",
    "VITE_SENTRY_DSN": "@sentry_dsn"
  }
}
```

### Environment Variable Alignment

**Unified env var naming across all components:**

| Variable | Extension | Dashboard | Backend | Description |
|----------|-----------|-----------|---------|-------------|
| `VITE_API_URL` | ✓ | ✓ | - | Backend API endpoint |
| `VITE_DASHBOARD_URL` | ✓ | - | - | Dashboard URL (for opening from extension) |
| `VITE_MAX_FILE_SIZE_MB` | ✓ | ✓ | - | Client-side file size limit |
| `VITE_SENTRY_DSN` | ✓ | ✓ | - | Sentry error tracking |
| `DEPLOYMENT_MODE` | - | - | ✓ | Backend deployment mode |
| `DASHBOARD_URL` | - | - | ✓ | Dashboard URL (for capabilities endpoint) |
| `MAX_UPLOAD_SIZE_MB` | - | - | ✓ | Server-side file size limit |
| `ALLOWED_FILE_EXTENSIONS` | - | - | ✓ | Server-allowed file types |

**Extension `.env.local`:**
```bash
VITE_API_URL=http://localhost:8000
VITE_DASHBOARD_URL=http://localhost:5173
VITE_MAX_FILE_SIZE_MB=10
VITE_SENTRY_DSN=https://...
```

**Dashboard `.env`:**
```bash
VITE_API_URL=https://api.faultmaven.ai
VITE_MAX_FILE_SIZE_MB=50
VITE_SENTRY_DSN=https://...
```

**Backend `.env`:**
```bash
DEPLOYMENT_MODE=enterprise
DASHBOARD_URL=https://app.faultmaven.ai
MAX_UPLOAD_SIZE_MB=50
ALLOWED_FILE_EXTENSIONS=.md,.txt,.log,.json,.csv,.pdf,.doc,.docx
DATABASE_URL=postgresql://...
```

---

## Testing Strategy

### Playwright E2E Tests

**File: `tests/e2e/dashboard.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Dashboard KB Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard
    await page.goto('http://localhost:5173');

    // Login
    await page.fill('input[type="text"]', 'testuser');
    await page.click('button:has-text("Sign In")');

    // Wait for redirect to /kb
    await page.waitForURL('**/kb');
  });

  test('upload document successfully', async ({ page }) => {
    // Click upload tab
    await page.click('button:has-text("Upload")');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('test-fixtures/sample-runbook.md');

    // Fill metadata
    await page.fill('input[name="title"]', 'Test Runbook');
    await page.selectOption('select[name="documentType"]', 'runbook');

    // Submit
    await page.click('button:has-text("Upload")');

    // Verify success
    await expect(page.locator('.upload-success')).toBeVisible();

    // Switch to documents tab
    await page.click('button:has-text("Documents")');

    // Verify document appears in list
    await expect(page.locator('text=Test Runbook')).toBeVisible();
  });

  test('search documents', async ({ page }) => {
    // Navigate to search tab
    await page.click('button:has-text("Search")');

    // Enter search query
    await page.fill('input[placeholder*="Search"]', 'kubernetes pod restart');
    await page.click('button:has-text("Search")');

    // Wait for results
    await page.waitForSelector('.search-results');

    // Verify results
    const results = page.locator('.search-result-item');
    await expect(results).toHaveCount({ min: 1 });
  });

  test('large file upload with progress', async ({ page }) => {
    // Create large file (15 MB)
    const largeContent = 'A'.repeat(15 * 1024 * 1024);
    const blob = new Blob([largeContent], { type: 'text/plain' });
    const file = new File([blob], 'large-file.txt');

    // Upload
    await page.click('button:has-text("Upload")');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({ name: 'large-file.txt', mimeType: 'text/plain', buffer: Buffer.from(largeContent) });

    await page.fill('input[name="title"]', 'Large Test File');
    await page.click('button:has-text("Upload")');

    // Verify progress bar appears
    await expect(page.locator('.upload-progress')).toBeVisible();

    // Wait for completion (may take time)
    await expect(page.locator('.upload-success')).toBeVisible({ timeout: 60000 });
  });

  test('network flakiness - retry on failure', async ({ page, context }) => {
    // Simulate network failure
    await context.route('**/api/v1/kb/documents', route => {
      if (Math.random() < 0.5) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    // Attempt upload
    await page.click('button:has-text("Upload")');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('test-fixtures/sample.md');
    await page.fill('input[name="title"]', 'Retry Test');
    await page.click('button:has-text("Upload")');

    // Should eventually succeed or show retry UI
    await expect(
      page.locator('.upload-success, .retry-button')
    ).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Extension Integration', () => {
  test('extension opens dashboard via button', async ({ page, context }) => {
    // Load extension (requires Chrome/Edge)
    // This test requires chromium with extension support
    const extensionPath = './dist/chrome-mv3';
    const browserContext = await test._extendWithPages(
      context,
      [extensionPath]
    );

    const [extensionPage] = browserContext.pages();

    // Click "Manage KB" button
    await extensionPage.click('button:has-text("Manage Knowledge Base")');

    // New tab should open with dashboard
    const dashboardPage = await context.waitForEvent('page');
    await expect(dashboardPage).toHaveURL(/.*\/kb$/);
  });
});
```

**File: `tests/e2e/extension.spec.ts`**

```typescript
import { test, expect, chromium } from '@playwright/test';
import path from 'path';

test.describe('Extension Adaptive UI', () => {
  test('self-hosted mode shows KB tabs', async () => {
    // Mock capabilities endpoint
    await page.route('**/v1/meta/capabilities', route => {
      route.fulfill({
        json: {
          deploymentMode: 'self-hosted',
          kbManagement: 'extension',
          features: {
            extensionKB: true,
            adminKB: false
          }
        }
      });
    });

    // Load extension page
    await page.goto('chrome-extension://[extension-id]/sidepanel_manual.html');

    // Verify KB tab is visible
    await expect(page.locator('button:has-text("Knowledge Base")')).toBeVisible();
  });

  test('enterprise mode hides KB tabs', async () => {
    // Mock capabilities endpoint
    await page.route('**/v1/meta/capabilities', route => {
      route.fulfill({
        json: {
          deploymentMode: 'enterprise',
          kbManagement: 'dashboard',
          dashboardUrl: 'https://app.faultmaven.ai',
          features: {
            extensionKB: false,
            adminKB: true
          }
        }
      });
    });

    await page.goto('chrome-extension://[extension-id]/sidepanel_manual.html');

    // Verify KB tab is NOT visible
    await expect(page.locator('button:has-text("Knowledge Base")')).not.toBeVisible();

    // Verify "Open Dashboard" button IS visible
    await expect(page.locator('button:has-text("Open Dashboard")')).toBeVisible();
  });
});
```

### Test Coverage Requirements

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:e2e": "playwright test",
    "test:coverage": "vitest --coverage",
    "test:all": "pnpm test:coverage && pnpm test:e2e"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "latest",
    "@playwright/test": "latest"
  }
}
```

**Coverage Thresholds (vitest.config.ts):**

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        'test/**',
        'dist/**'
      ]
    }
  }
});
```

---

## Rollout Plan

### Phase 1: Internal Beta (Week 1)

**Objective:** Test with internal team, catch critical bugs

1. **Deploy staging environment:**
   - Backend: `https://api-staging.faultmaven.ai`
   - Dashboard: `https://dashboard-staging.faultmaven.ai`
   - Extension: Unlisted Chrome Web Store version

2. **Invite internal testers (10-20 people):**
   - Dev team
   - QA team
   - Product managers
   - Early adopters from support team

3. **Monitoring:**
   - Sentry error tracking
   - User feedback form in extension
   - Daily standup to review issues

4. **Success Criteria:**
   - Zero P0/P1 bugs
   - < 5 P2 bugs
   - Positive feedback from >80% of testers

### Phase 2: External Beta (Week 2-3)

**Objective:** Validate with real users, gather UX feedback

1. **Expand beta cohort:**
   - Invite 100-200 external users
   - Target power users and vocal community members
   - Email invitation with beta opt-in link

2. **Feedback collection:**
   - In-app survey after 1 week
   - Support channel monitoring
   - Usage analytics review

3. **Iterate based on feedback:**
   - Fix P1/P2 bugs
   - Adjust UI based on UX feedback
   - Performance tuning

4. **Success Criteria:**
   - Dashboard adoption rate >60%
   - Extension performance meets targets (<200ms load)
   - User satisfaction score >4/5

### Phase 3: Staged Rollout (Week 3-4)

**Objective:** Gradually roll out to all users with monitoring

**Chrome Web Store Staged Release:**

1. **10% rollout (Day 1-2):**
   - Release to 10% of users via Chrome Web Store percentage rollout
   - Monitor error rates, crash rates, performance metrics
   - Watch support tickets

2. **50% rollout (Day 3-5):**
   - If metrics stable, increase to 50%
   - Continue monitoring

3. **100% rollout (Day 6-7):**
   - Full release to all users
   - Announcement email
   - Blog post / changelog

**Firefox Add-ons:**
- No staged rollout support
- Release after Chrome 100% rollout successful
- Monitor AMO reviews and support tickets

### Phase 4: Post-Launch Monitoring (Week 4+)

**Objective:** Ensure stability, address issues quickly

1. **Daily monitoring (first week):**
   - Error rates
   - Dashboard adoption
   - Support ticket volume
   - User feedback

2. **Weekly reviews (weeks 2-4):**
   - Metrics dashboard review
   - User satisfaction surveys
   - Feature usage analysis

3. **Hotfix process:**
   - P0 bugs: Fix within 24 hours
   - P1 bugs: Fix within 1 week
   - P2 bugs: Fix in next release

---

## Failure Modes & Resilience

### Failure Mode Matrix

| Scenario | Impact | Extension Behavior | Dashboard Behavior | Mitigation |
|----------|--------|-------------------|-------------------|------------|
| **Dashboard down (5xx)** | High | Show fallback message + status ribbon | N/A | Cache last-known status, provide extension-based KB upload (if self-host mode) |
| **API down** | Critical | Show offline notice, queue writes | Show offline notice | Retry with backoff, local queue for uploads |
| **Indexing backlog** | Medium | Show "Pending indexing" in chat | Show progress bar with ETA | Display estimated wait time, allow chat to continue |
| **Capabilities endpoint fails** | Medium | Assume self-hosted mode (safe default) | N/A | Cache last capabilities, use conservative defaults |
| **Auth token expired** | Medium | Redirect to login | Redirect to login | Silent refresh if refresh token available |
| **Large file upload timeout** | Low | Show retry button | Show retry button | Chunked upload with resume support |

### Dashboard Down - Fallback UI

**Extension fallback when dashboard unreachable:**

```typescript
// File: src/shared/ui/components/DashboardButton.tsx

export function DashboardButton({ dashboardUrl }: { dashboardUrl: string }) {
  const [dashboardStatus, setDashboardStatus] = useState<'up' | 'down' | 'unknown'>('unknown');

  useEffect(() => {
    const checkDashboardHealth = async () => {
      try {
        const response = await fetch(`${dashboardUrl}/health`, {
          method: 'HEAD',
          mode: 'no-cors'
        });
        setDashboardStatus('up');
      } catch (error) {
        setDashboardStatus('down');
      }
    };

    checkDashboardHealth();
    const interval = setInterval(checkDashboardHealth, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [dashboardUrl]);

  const handleClick = async () => {
    if (dashboardStatus === 'down') {
      // Show fallback
      const userConfirm = confirm(
        'Dashboard is currently unavailable. Would you like to try anyway, or use extension KB management?'
      );

      if (!userConfirm) {
        // TODO: Enable extension KB as fallback
        return;
      }
    }

    // Open dashboard
    await browser.tabs.create({ url: `${dashboardUrl}/kb` });
  };

  return (
    <div>
      <button onClick={handleClick} className="dashboard-button">
        📚 Manage Knowledge Base
        {dashboardStatus === 'down' && (
          <span className="status-indicator status-down" title="Dashboard unavailable"></span>
        )}
      </button>

      {dashboardStatus === 'down' && (
        <div className="warning-ribbon">
          Dashboard is temporarily unavailable. KB uploads are paused. Chat remains functional.
        </div>
      )}
    </div>
  );
}
```

### Offline Queue for Uploads

**File: `src/lib/offline-queue.ts`**

```typescript
interface QueuedUpload {
  id: string;
  file: File;
  metadata: {
    title: string;
    documentType: string;
    tags?: string;
  };
  timestamp: number;
  retryCount: number;
}

class OfflineUploadQueue {
  private queue: QueuedUpload[] = [];
  private processing = false;

  async add(file: File, metadata: any): Promise<string> {
    const id = `queued_${Date.now()}`;
    const item: QueuedUpload = {
      id,
      file,
      metadata,
      timestamp: Date.now(),
      retryCount: 0
    };

    this.queue.push(item);
    await this.persist();

    // Start processing if not already
    if (!this.processing) {
      this.processQueue();
    }

    return id;
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];

      try {
        // Attempt upload
        await uploadKnowledgeDocument(item.file, item.metadata);

        // Success - remove from queue
        this.queue.shift();
        await this.persist();

      } catch (error) {
        // Failure - retry or give up
        item.retryCount++;

        if (item.retryCount >= 3) {
          // Give up after 3 retries
          console.error('[OfflineQueue] Failed to upload after 3 retries:', item.id);
          this.queue.shift(); // Remove failed item
          await this.persist();

          // Notify user
          showNotification({
            title: 'Upload Failed',
            message: `Failed to upload "${item.metadata.title}". Please try again manually.`
          });
        } else {
          // Wait before retry (exponential backoff)
          const delay = Math.pow(2, item.retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.processing = false;
  }

  private async persist() {
    // Store queue in browser storage
    const serialized = this.queue.map(item => ({
      id: item.id,
      fileName: item.file.name,
      fileSize: item.file.size,
      metadata: item.metadata,
      timestamp: item.timestamp,
      retryCount: item.retryCount
    }));

    await browser.storage.local.set({ uploadQueue: serialized });
  }

  async restore() {
    const { uploadQueue } = await browser.storage.local.get(['uploadQueue']);
    if (uploadQueue && Array.isArray(uploadQueue)) {
      // Note: Can't restore File objects from storage
      // Users will need to re-select files
      console.log(`[OfflineQueue] ${uploadQueue.length} uploads pending from previous session`);
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export const offlineUploadQueue = new OfflineUploadQueue();
```

### Indexing Backlog - User Communication

**Show estimated time for indexing:**

```typescript
// File: src/shared/ui/components/IndexingStatus.tsx

export function IndexingStatus({ documentId }: { documentId: string }) {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch(
          `${config.apiUrl}/api/v1/kb/documents/${documentId}/status`
        );
        const data = await response.json();
        setStatus(data);

        // Keep polling if not complete
        if (data.indexing_status !== 'complete' && data.indexing_status !== 'failed') {
          setTimeout(pollStatus, 2000);
        }
      } catch (error) {
        console.error('[IndexingStatus] Polling failed:', error);
      }
    };

    pollStatus();
  }, [documentId]);

  if (!status) return <div>Checking status...</div>;

  if (status.indexing_status === 'complete') {
    return (
      <div className="flex items-center gap-2 text-green-600">
        <CheckIcon className="w-4 h-4" />
        <span>Indexed and ready for RAG</span>
      </div>
    );
  }

  if (status.indexing_status === 'failed') {
    return (
      <div className="flex items-center gap-2 text-red-600">
        <XIcon className="w-4 h-4" />
        <span>Indexing failed: {status.error}</span>
      </div>
    );
  }

  // Pending or processing
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-blue-600">
        <SpinnerIcon className="w-4 h-4 animate-spin" />
        <span>Indexing in progress... ({status.progress || 0}%)</span>
      </div>
      {status.estimated_completion && (
        <p className="text-xs text-gray-500">
          Estimated completion: {new Date(status.estimated_completion).toLocaleTimeString()}
        </p>
      )}
      <p className="text-xs text-gray-500">
        Your document will be available for RAG once indexing completes.
        You can continue using the chat in the meantime.
      </p>
    </div>
  );
}
```

---

## Accessibility & UX

### Keyboard Navigation

**All interactive elements must be keyboard accessible:**

```typescript
// File: src/shared/ui/components/DocumentsListView.tsx

export function DocumentsListView({ documents, onSelect, onDelete }: Props) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, documents.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(documents[focusedIndex]);
        break;
      case 'Delete':
        e.preventDefault();
        if (confirm('Delete this document?')) {
          onDelete(documents[focusedIndex].document_id);
        }
        break;
    }
  };

  return (
    <div
      role="listbox"
      aria-label="Knowledge base documents"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="documents-list"
    >
      {documents.map((doc, index) => (
        <div
          key={doc.document_id}
          role="option"
          aria-selected={index === focusedIndex}
          className={`document-item ${index === focusedIndex ? 'focused' : ''}`}
        >
          {doc.title}
        </div>
      ))}
    </div>
  );
}
```

### Focus Traps in Modals

```typescript
// File: src/shared/ui/components/Modal.tsx

import { useEffect, useRef } from 'react';

export function Modal({ isOpen, onClose, children }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Store current focus
      previousFocusRef.current = document.activeElement as HTMLElement;

      // Focus first focusable element in modal
      const focusableElements = modalRef.current?.querySelectorAll(
        'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements && focusableElements.length > 0) {
        (focusableElements[0] as HTMLElement).focus();
      }

      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    }

    return () => {
      // Restore focus on close
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }

    // Trap focus within modal
    if (e.key === 'Tab') {
      const focusableElements = modalRef.current?.querySelectorAll(
        'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={modalRef}
        className="modal-content"
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
```

### ARIA Labels & Screen Reader Support

```typescript
// File: src/shared/ui/components/SearchPanel.tsx

export function SearchPanel({ onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  return (
    <div className="search-panel">
      <label htmlFor="kb-search-input" className="sr-only">
        Search knowledge base
      </label>
      <input
        id="kb-search-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search knowledge base..."
        aria-describedby="search-help"
        aria-busy={searching}
      />
      <span id="search-help" className="sr-only">
        Enter keywords to search your knowledge base documents
      </span>

      <button
        onClick={() => onSearch(query)}
        aria-label="Search"
        disabled={!query || searching}
      >
        {searching ? 'Searching...' : 'Search'}
      </button>

      <div
        role="region"
        aria-live="polite"
        aria-label="Search results"
      >
        {results.length === 0 && query && (
          <p>No results found for "{query}"</p>
        )}
        {results.length > 0 && (
          <ul aria-label={`${results.length} results found`}>
            {results.map((result) => (
              <li key={result.id}>
                <a href={`#doc-${result.id}`} aria-label={`View ${result.title}`}>
                  {result.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

### Empty, Loading, and Error States

**Consistent state UI across all views:**

```typescript
// File: src/shared/ui/components/StateViews.tsx

export function LoadingView({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12" role="status">
      <SpinnerIcon className="w-8 h-8 text-blue-600 animate-spin mb-4" />
      <p className="text-gray-600">{message}</p>
      <span className="sr-only">{message}</span>
    </div>
  );
}

export function EmptyView({
  icon,
  title,
  description,
  action
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      {icon && <div className="mb-4 text-gray-400">{icon}</div>}
      <h3 className="text-lg font-semibold text-gray-800 mb-2">{title}</h3>
      <p className="text-sm text-gray-600 mb-6 max-w-md">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ErrorView({
  error,
  onRetry
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center" role="alert">
      <XCircleIcon className="w-12 h-12 text-red-500 mb-4" />
      <h3 className="text-lg font-semibold text-gray-800 mb-2">Something went wrong</h3>
      <p className="text-sm text-gray-600 mb-6 max-w-md">{error}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

// Usage in DocumentsListView
export function DocumentsListView({ documents, loading, error, onRetry }: Props) {
  if (loading) {
    return <LoadingView message="Loading documents..." />;
  }

  if (error) {
    return <ErrorView error={error} onRetry={onRetry} />;
  }

  if (documents.length === 0) {
    return (
      <EmptyView
        icon={<DocumentIcon className="w-16 h-16" />}
        title="No documents yet"
        description="Upload your first runbook or SOP to get started with AI-powered troubleshooting."
        action={{
          label: 'Upload Document',
          onClick: () => switchToUploadTab()
        }}
      />
    );
  }

  return (
    <div className="documents-grid">
      {/* ... documents */}
    </div>
  );
}
```

---

## Appendices

### A. Complete File Type & Size Limits

**Canonical List (Server-Enforced):**

| File Extension | MIME Type | Max Size (Community) | Max Size (Enterprise) | Notes |
|----------------|-----------|---------------------|----------------------|-------|
| `.md` | `text/markdown` | 10 MB | 50 MB | Markdown documents |
| `.txt` | `text/plain` | 10 MB | 50 MB | Plain text |
| `.log` | `text/plain` | 10 MB | 50 MB | Log files |
| `.json` | `application/json` | 10 MB | 50 MB | JSON data |
| `.csv` | `text/csv` | 10 MB | 50 MB | CSV data |
| `.pdf` | `application/pdf` | Not supported | 50 MB | Requires text extraction |
| `.doc` | `application/msword` | Not supported | 50 MB | Legacy Word |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Not supported | 50 MB | Modern Word |
| `.yaml` | `text/yaml` | 10 MB | 50 MB | YAML config |
| `.xml` | `application/xml` | 10 MB | 50 MB | XML data |

**Backend Validation:**

```python
# backend/api/v1/kb.py

ALLOWED_EXTENSIONS_COMMUNITY = {'.md', '.txt', '.log', '.json', '.csv', '.yaml'}
ALLOWED_EXTENSIONS_ENTERPRISE = ALLOWED_EXTENSIONS_COMMUNITY | {'.pdf', '.doc', '.docx', '.xml'}

MAX_FILE_SIZE_COMMUNITY = 10 * 1024 * 1024  # 10 MB
MAX_FILE_SIZE_ENTERPRISE = 50 * 1024 * 1024  # 50 MB

def validate_upload(file: UploadFile, deployment_mode: str):
    # Extension check
    ext = Path(file.filename).suffix.lower()
    allowed = ALLOWED_EXTENSIONS_ENTERPRISE if deployment_mode == 'enterprise' else ALLOWED_EXTENSIONS_COMMUNITY

    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"File type {ext} not allowed. Supported: {', '.join(allowed)}"
        )

    # Size check
    max_size = MAX_FILE_SIZE_ENTERPRISE if deployment_mode == 'enterprise' else MAX_FILE_SIZE_COMMUNITY
    file.file.seek(0, 2)  # Seek to end
    size = file.file.tell()
    file.file.seek(0)  # Reset

    if size > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({size} bytes). Maximum: {max_size} bytes"
        )

    return True
```

### B. Backward Compatibility

**Ensure old extension versions (v0.3.x) continue to work during migration:**

1. **Backend maintains KB API endpoints:**
   - `/api/v1/kb/documents` (upload, list, delete)
   - Don't deprecate these endpoints
   - Add deprecation warnings in response headers (for v0.4.0+)

2. **Extension version detection:**
   ```python
   # Backend: Check extension version from User-Agent
   @router.post("/kb/documents")
   async def upload_document(request: Request, ...):
       user_agent = request.headers.get("User-Agent", "")
       extension_version = parse_extension_version(user_agent)

       if extension_version and extension_version < "0.4.0":
           # Old extension - provide backward-compatible response
           response.headers["X-Deprecation-Warning"] = "Please update to v0.4.0 for best experience"

       return response
   ```

3. **Grace period:**
   - Maintain old KB APIs for **6 months** after v0.4.0 release
   - Send in-app notification to v0.3.x users: "Update available"
   - After 6 months, consider sunset (with advance notice)

### C. Quick Add Capture (Future Enhancement)

**Allow users to capture content from active page for later curation:**

```typescript
// File: src/entrypoints/page-content.content.ts

// Context menu item: "Add to FaultMaven KB"
browser.contextMenus.create({
  id: 'quick-add-kb',
  title: 'Quick Add to Knowledge Base',
  contexts: ['selection', 'page']
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'quick-add-kb') {
    const content = info.selectionText || await capturePageContent(tab);

    await offlineUploadQueue.add(
      new File([content], `quick-add-${Date.now()}.md`),
      {
        title: tab.title || 'Untitled',
        documentType: 'snippet',
        tags: 'quick-add',
        sourceUrl: tab.url,
        capturedAt: new Date().toISOString()
      }
    );

    // Show notification
    browser.notifications.create({
      type: 'basic',
      title: 'Added to KB Queue',
      message: 'Content saved for later curation in dashboard'
    });
  }
});
```

### D. Export/Backup Feature (Future Enhancement)

**Allow users to export entire KB as ZIP:**

```python
# backend/api/v1/kb.py

@router.get("/export")
async def export_knowledge_base(
    current_user: User = Depends(get_current_user)
):
    """
    Export all user KB documents as ZIP file with metadata.
    Useful for backup, migration, and compliance.
    """
    documents = await get_user_kb_documents(current_user.user_id)

    # Create ZIP in memory
    zip_buffer = BytesIO()
    with ZipFile(zip_buffer, 'w', ZIP_DEFLATED) as zip_file:
        # Add metadata.json
        metadata = {
            "export_date": datetime.utcnow().isoformat(),
            "user_id": current_user.user_id,
            "document_count": len(documents),
            "documents": [
                {
                    "document_id": doc.document_id,
                    "title": doc.title,
                    "document_type": doc.document_type,
                    "created_at": doc.created_at.isoformat(),
                    "file_name": doc.file_name
                }
                for doc in documents
            ]
        }
        zip_file.writestr("metadata.json", json.dumps(metadata, indent=2))

        # Add all documents
        for doc in documents:
            file_path = f"documents/{doc.document_id}/{doc.file_name}"
            content = await get_document_content(doc.document_id)
            zip_file.writestr(file_path, content)

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=faultmaven-kb-export-{datetime.utcnow().strftime('%Y%m%d')}.zip"
        }
    )
```

---

**Document End**

**Last Updated:** 2025-11-15
**Version:** 2.0
**Maintained by:** FaultMaven Engineering Team

**Changelog:**
- v2.0 (2025-11-15): Complete rewrite for adaptive multi-mode architecture with capabilities negotiation
- v1.0 (2025-11-14): Initial version (simple split approach)
