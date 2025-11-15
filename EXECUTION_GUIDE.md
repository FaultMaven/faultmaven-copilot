# FaultMaven Migration: Step-by-Step Execution Guide

**Purpose:** Detailed step-by-step instructions to execute the migration from Option A to Option B (Universal Split Architecture)

**Prerequisites:** Read [MIGRATION_GUIDE_V2.md](./MIGRATION_GUIDE_V2.md) for architecture and design decisions

**Timeline:** 2-3 weeks for full migration

---

## Table of Contents

1. [Overview](#overview)
2. [Task 1: Create faultmaven-copilot (Refactored)](#task-1-create-faultmaven-copilot-refactored)
3. [Task 2: Create faultmaven-dashboard](#task-2-create-faultmaven-dashboard)
4. [Task 3: Update Backend](#task-3-update-backend)
5. [Task 4: Testing](#task-4-testing)
6. [Task 5: Deployment](#task-5-deployment)

---

## Overview

### Current State
- Repository: `faultmaven-original-copilot` (private, contains KB UI in extension)
- Backend: Has KB API endpoints, no capabilities endpoint

### Target State
- Repository 1: `faultmaven-copilot` (public, chat-only extension)
- Repository 2: `faultmaven-dashboard` (public, KB management web app)
- Backend: Has `/v1/meta/capabilities` endpoint

### Migration Strategy
1. Create new public repos (don't modify original)
2. Refactor extension in new repo
3. Build dashboard in new repo
4. Update backend to add capabilities API
5. Test both deployments
6. Deploy

---

## Task 1: Create faultmaven-copilot (Refactored)

**Goal:** Chat-only extension, capabilities-driven UI, public repository

### Step 1.1: Create GitHub Repository

```bash
# Create new public repo on GitHub
# Name: faultmaven-copilot
# Description: AI-powered troubleshooting assistant (browser extension)
# Visibility: Public
# Initialize: No README, no .gitignore, no license
```

**GitHub UI:**
1. Go to https://github.com/new
2. Owner: `sterlanyu` (or your org)
3. Repository name: `faultmaven-copilot`
4. Description: `AI-powered troubleshooting assistant for SRE and DevOps teams`
5. Visibility: **Public**
6. Don't initialize with README (we'll copy from original)
7. Click "Create repository"

### Step 1.2: Copy Original Codebase

```bash
# Navigate to parent directory
cd ~/projects

# Copy entire original repo to new folder
cp -r faultmaven-original-copilot faultmaven-copilot

# Navigate to new folder
cd faultmaven-copilot

# Remove old Git history
rm -rf .git

# Initialize new Git repo
git init

# Add new remote
git remote add origin https://github.com/sterlanyu/faultmaven-copilot.git

# Create initial commit (before refactoring)
git add .
git commit -m "Initial commit - copied from faultmaven-original-copilot"

# Push to new repo
git push -u origin main
```

### Step 1.3: Create Refactor Branch

```bash
# Create feature branch for refactoring
git checkout -b refactor/universal-split-architecture

# Now all changes will be on this branch
```

### Step 1.4: Remove KB Components

**Files to DELETE:**

```bash
# Delete KB view components
rm src/shared/ui/KnowledgeBaseView.tsx
rm src/shared/ui/GlobalKBView.tsx

# Delete KB-specific components
rm src/shared/ui/components/UploadPanel.tsx
rm src/shared/ui/components/DocumentsListView.tsx
rm src/shared/ui/components/SearchPanel.tsx
rm src/shared/ui/components/EditMetadataModal.tsx

# Keep DocumentDetailsModal.tsx (used for viewing sources in chat)
# Keep ErrorState.tsx (used throughout)
```

**Commit deletions:**

```bash
git add .
git commit -m "refactor: Remove KB components from extension

- Deleted KnowledgeBaseView.tsx and GlobalKBView.tsx
- Deleted UploadPanel, DocumentsListView, SearchPanel
- Deleted EditMetadataModal
- Kept DocumentDetailsModal (used for chat sources)
- Kept ErrorState (reusable component)

These components will be moved to faultmaven-dashboard."
```

### Step 1.5: Update API Client

**File: `src/lib/api.ts`**

Remove KB-related functions:

```bash
# Open src/lib/api.ts in your editor
# Delete these functions:
# - uploadUserKBDocument()
# - uploadAdminKBDocument()
# - getUserKBDocuments()
# - getAdminKBDocuments()
# - deleteUserKBDocument()
# - deleteAdminKBDocument()
# - updateKnowledgeDocument()
# - searchKnowledgeBase()

# Keep only:
# - createSession(), deleteSession()
# - createCase(), submitQueryToCase(), uploadDataToCase()
# - getUserCases(), getCaseConversation()
# - getKnowledgeDocument() (for viewing sources)
# - devLogin(), logoutAuth()
```

**Commit:**

```bash
git add src/lib/api.ts
git commit -m "refactor: Remove KB management functions from API client

Removed:
- uploadUserKBDocument, uploadAdminKBDocument
- getUserKBDocuments, getAdminKBDocuments
- deleteUserKBDocument, deleteAdminKBDocument
- updateKnowledgeDocument, searchKnowledgeBase

Kept:
- Session management (createSession, deleteSession)
- Case management (createCase, submitQueryToCase, etc.)
- getKnowledgeDocument (for viewing chat sources)
- Authentication (devLogin, logoutAuth)

KB management now handled by faultmaven-dashboard."
```

### Step 1.6: Add Capabilities Manager

**Create new file: `src/lib/capabilities.ts`**

Copy the complete implementation from MIGRATION_GUIDE_V2.md section "Extension: Universal Implementation"

```bash
# Create new file
touch src/lib/capabilities.ts

# Paste the CapabilitiesManager code from the guide
# (See MIGRATION_GUIDE_V2.md lines 440-558)
```

**Commit:**

```bash
git add src/lib/capabilities.ts
git commit -m "feat: Add capabilities manager for backend feature discovery

- Implements GET /v1/meta/capabilities
- Caches capabilities in browser.storage
- Fallback to self-hosted mode on failure
- Provides helpers: getDashboardUrl(), getUploadLimits()

This enables the extension to adapt UI based on backend deployment mode."
```

### Step 1.7: Create Welcome Screen Component

**Create new file: `src/shared/ui/components/WelcomeScreen.tsx`**

Copy from MIGRATION_GUIDE_V2.md section "First-Run Experience"

```bash
touch src/shared/ui/components/WelcomeScreen.tsx

# Paste the complete WelcomeScreen component
# (See MIGRATION_GUIDE_V2.md lines 788-943)
```

**Commit:**

```bash
git add src/shared/ui/components/WelcomeScreen.tsx
git commit -m "feat: Add first-run welcome screen

- Two-option setup: Enterprise Cloud vs Self-Hosted
- Enterprise: Sets API endpoint to api.faultmaven.ai (default)
- Self-Hosted: Opens settings for localhost configuration
- Professional UI with clear benefits for each mode
- Shows on first extension launch only"
```

### Step 1.8: Create Loading and Error Screen Components

**Create: `src/shared/ui/components/LoadingScreen.tsx`**

```typescript
import React from 'react';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
}
```

**Create: `src/shared/ui/components/ErrorScreen.tsx`**

```typescript
import React from 'react';

interface ErrorScreenProps {
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ErrorScreen({ message, action }: ErrorScreenProps) {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center max-w-md p-8">
        <svg
          className="w-16 h-16 text-red-500 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Connection Error
        </h2>
        <p className="text-gray-600 mb-6">{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
```

**Commit:**

```bash
git add src/shared/ui/components/LoadingScreen.tsx src/shared/ui/components/ErrorScreen.tsx
git commit -m "feat: Add loading and error screen components

- LoadingScreen: Shown while connecting to backend
- ErrorScreen: Shown on connection failure with action button
- Consistent UX for all loading/error states"
```

### Step 1.9: Update SidePanelApp.tsx

**Replace entire file with new implementation from MIGRATION_GUIDE_V2.md**

**File: `src/shared/ui/SidePanelApp.tsx`**

Key changes:
1. Add capabilities state
2. Add first-run check
3. Fetch `/v1/meta/capabilities` on startup
4. Show WelcomeScreen if first run
5. Remove all KB tab logic

See MIGRATION_GUIDE_V2.md lines 565-679 for complete code.

**Commit:**

```bash
git add src/shared/ui/SidePanelApp.tsx
git commit -m "refactor: Update SidePanelApp for capabilities-driven UI

Changes:
- Removed all KB tab state and logic
- Added first-run check (shows WelcomeScreen)
- Fetch capabilities on startup
- Show deployment mode badge (self-hosted vs enterprise)
- Error handling with settings link
- Chat-only UI (no KB tabs)

The extension now adapts based on backend capabilities."
```

### Step 1.10: Update CollapsibleNavigation.tsx

**File: `src/shared/ui/layouts/CollapsibleNavigation.tsx`**

Changes:
1. Remove KB tab navigation
2. Add "Manage Knowledge Base" button (opens dashboard)
3. Add settings button
4. Show branding from capabilities

See MIGRATION_GUIDE_V2.md lines 687-778 for complete code.

**Commit:**

```bash
git add src/shared/ui/layouts/CollapsibleNavigation.tsx
git commit -m "refactor: Update navigation for chat-only + dashboard link

Changes:
- Removed KB tab buttons
- Added 'Manage Knowledge Base' button (opens dashboardUrl)
- Added settings button
- Display branding from capabilities
- Simplified navigation (chat-only focus)"
```

### Step 1.11: Create Options Page (Settings)

**Create: `src/entrypoints/options.html`**

See MIGRATION_GUIDE_V2.md lines 950-989 for complete HTML.

**Create: `src/entrypoints/options.ts`**

See MIGRATION_GUIDE_V2.md lines 994-1083 for complete TypeScript.

**Commit:**

```bash
git add src/entrypoints/options.html src/entrypoints/options.ts
git commit -m "feat: Add extension settings page

Features:
- API endpoint configuration
- Test connection button
- Displays detected deployment mode (self-hosted vs enterprise)
- Save settings with validation
- User-friendly help text

Self-hosted users configure localhost:8000 here."
```

### Step 1.12: Update Package Version

**File: `package.json`**

```json
{
  "name": "faultmaven-copilot",
  "version": "0.4.0",
  "description": "AI-powered troubleshooting assistant - chat-focused, capabilities-driven"
}
```

**File: `wxt.config.ts`**

```typescript
manifest: {
  version: "0.4.0",
  name: "FaultMaven Copilot",
  description: "AI-powered troubleshooting assistant for SRE and DevOps teams",
}
```

**Commit:**

```bash
git add package.json wxt.config.ts
git commit -m "chore: Bump version to 0.4.0 for universal split release"
```

### Step 1.13: Update Documentation

**File: `README.md`**

Update to reflect new architecture:

```markdown
# FaultMaven Copilot

AI-powered troubleshooting assistant for SRE and DevOps teams.

## Features

- 💬 **Real-time Chat:** Chat with AI during incidents
- 📊 **Context-Aware:** Analyzes page content for better assistance
- 🔗 **Knowledge Base Integration:** Uses your team's runbooks via dashboard
- 🚀 **Fast & Lightweight:** 450 KB extension, <200ms load time

## Installation

### For Enterprise Cloud Users

1. Install from [Chrome Web Store](#)
2. On first launch, choose "Enterprise Cloud"
3. Login with your credentials
4. Extension connects to `api.faultmaven.ai`
5. Manage KB at [app.faultmaven.ai](https://app.faultmaven.ai)

### For Self-Hosted Users

1. Run backend and dashboard:
   ```bash
   git clone https://github.com/faultmaven/faultmaven-backend.git
   cd faultmaven-backend
   docker-compose up -d
   ```

2. Install extension from [Chrome Web Store](#)

3. On first launch, choose "Self-Hosted"

4. Extension opens settings automatically

5. Verify:
   - API Endpoint: `http://localhost:8000`
   - Click "Test Connection"
   - Should show "✓ Connected to self-hosted backend"

6. Manage KB at `http://localhost:3000`

## Architecture

This extension is **chat-only**. Knowledge Base management happens in:
- **Enterprise:** [app.faultmaven.ai](https://app.faultmaven.ai)
- **Self-Hosted:** http://localhost:3000

See [faultmaven-dashboard](https://github.com/sterlanyu/faultmaven-dashboard) for KB management UI.

## Development

```bash
pnpm install
pnpm dev          # Chrome dev mode
pnpm dev:firefox  # Firefox dev mode
pnpm build        # Production build
pnpm test         # Run tests
```

## Documentation

- [Migration Guide](./MIGRATION_GUIDE_V2.md) - Architecture and design decisions
- [Execution Guide](./EXECUTION_GUIDE.md) - Step-by-step implementation

## License

MIT
```

**Commit:**

```bash
git add README.md
git commit -m "docs: Update README for universal split architecture

- Clarifies chat-only extension
- Separate installation instructions for enterprise vs self-hosted
- Links to faultmaven-dashboard repo
- Updated architecture description"
```

### Step 1.14: Build and Test

```bash
# Install dependencies
pnpm install

# TypeScript compilation check
pnpm compile

# Should pass with no errors

# Build extension
pnpm build

# Check bundle size
du -sh .output/chrome-mv3
# Should be ~450 KB (down from ~850 KB)

# Load in Chrome for testing
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select .output/chrome-mv3-dev folder
```

**Expected behavior:**
1. Welcome screen shows on first launch
2. Choose "Self-Hosted" → settings page opens
3. Set API to `http://localhost:8000` (or any test backend)
4. Extension shows error if backend not running (expected)
5. No KB tabs visible anywhere
6. "Manage Knowledge Base" button present

### Step 1.15: Merge and Push

```bash
# Merge refactor branch to main
git checkout main
git merge refactor/universal-split-architecture

# Push to GitHub
git push origin main

# Tag release
git tag v0.4.0
git push origin v0.4.0
```

---

## Task 2: Create faultmaven-dashboard

**Goal:** Standalone web app for KB management, works for both self-hosted and enterprise

### Step 2.1: Create GitHub Repository

**GitHub UI:**
1. Go to https://github.com/new
2. Repository name: `faultmaven-dashboard`
3. Description: `Knowledge Base management dashboard for FaultMaven`
4. Visibility: **Public**
5. Initialize with: README
6. Add .gitignore: Node
7. License: MIT
8. Click "Create repository"

### Step 2.2: Clone and Initialize Project

```bash
# Clone new repo
cd ~/projects
git clone https://github.com/sterlanyu/faultmaven-dashboard.git
cd faultmaven-dashboard

# Create React + TypeScript project using Vite
npm create vite@latest . -- --template react-ts

# Answer prompts:
# - Current directory is not empty. Remove existing files and continue? Yes
# - Package name: faultmaven-dashboard

# Install dependencies
npm install

# Install additional dependencies
npm install react-router-dom
npm install -D tailwindcss postcss autoprefixer
npm install -D @tailwindcss/typography
npm install @fontsource/inter

# Initialize Tailwind
npx tailwindcss init -p
```

### Step 2.3: Configure Tailwind

**File: `tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
```

**File: `src/index.css`**

```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter/700.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1f2937;
  background-color: #f9fafb;
  margin: 0;
}
```

**Commit:**

```bash
git add .
git commit -m "chore: Initialize Vite + React + TypeScript project with Tailwind"
```

### Step 2.4: Copy Components from Extension

**Copy these files from `faultmaven-copilot` to `faultmaven-dashboard`:**

```bash
# Navigate to extension repo
cd ~/projects/faultmaven-copilot

# Create directory structure in dashboard repo
mkdir -p ~/projects/faultmaven-dashboard/src/components
mkdir -p ~/projects/faultmaven-dashboard/src/lib
mkdir -p ~/projects/faultmaven-dashboard/src/lib/hooks
mkdir -p ~/projects/faultmaven-dashboard/src/pages

# Copy KB view components (these were deleted from extension)
# You'll need to copy from faultmaven-original-copilot or from git history

cd ~/projects/faultmaven-original-copilot

# Copy main KB views
cp src/shared/ui/KnowledgeBaseView.tsx ~/projects/faultmaven-dashboard/src/pages/KBPage.tsx
cp src/shared/ui/GlobalKBView.tsx ~/projects/faultmaven-dashboard/src/pages/AdminKBPage.tsx

# Copy KB components
cp src/shared/ui/components/UploadPanel.tsx ~/projects/faultmaven-dashboard/src/components/
cp src/shared/ui/components/DocumentsListView.tsx ~/projects/faultmaven-dashboard/src/components/
cp src/shared/ui/components/SearchPanel.tsx ~/projects/faultmaven-dashboard/src/components/
cp src/shared/ui/components/EditMetadataModal.tsx ~/projects/faultmaven-dashboard/src/components/
cp src/shared/ui/components/DocumentDetailsModal.tsx ~/projects/faultmaven-dashboard/src/components/
cp src/shared/ui/components/ErrorState.tsx ~/projects/faultmaven-dashboard/src/components/

# Copy API client
cp src/lib/api.ts ~/projects/faultmaven-dashboard/src/lib/
cp src/lib/errors.ts ~/projects/faultmaven-dashboard/src/lib/

# Copy auth hook
cp src/shared/ui/hooks/useAuth.tsx ~/projects/faultmaven-dashboard/src/lib/hooks/
```

### Step 2.5: Adapt Copied Components for Web

**The copied components use browser extension APIs. Need to adapt for web:**

**File: `src/lib/api.ts`**

Replace all `browser.storage` calls with `localStorage`:

```typescript
// BEFORE (extension):
const { authToken } = await browser.storage.local.get(['authToken']);

// AFTER (web):
const authToken = localStorage.getItem('faultmaven_auth_token');
```

Search and replace in `src/lib/api.ts`:
- Remove `import { browser } from 'wxt/browser';`
- Replace `browser.storage.local.get()` → `localStorage.getItem()`
- Replace `browser.storage.local.set()` → `localStorage.setItem()`
- Replace `browser.storage.local.remove()` → `localStorage.removeItem()`

**File: `src/lib/hooks/useAuth.tsx`**

Same changes - replace browser.storage with localStorage.

**Commit:**

```bash
cd ~/projects/faultmaven-dashboard
git add src/components src/lib src/pages
git commit -m "feat: Add KB management components from extension

Copied from faultmaven-original-copilot:
- KBPage.tsx (was KnowledgeBaseView.tsx)
- AdminKBPage.tsx (was GlobalKBView.tsx)
- UploadPanel, DocumentsListView, SearchPanel
- EditMetadataModal, DocumentDetailsModal, ErrorState
- API client and auth hook

Adapted for web environment:
- Replaced browser.storage with localStorage
- Removed extension-specific imports"
```

### Step 2.6: Create Config File

**File: `src/lib/config.ts`**

```typescript
interface Config {
  apiUrl: string;
  maxFileSize: number;
  allowedFileExtensions: readonly string[];
}

const config: Config = {
  apiUrl: import.meta.env.VITE_API_URL || 'https://api.faultmaven.ai',
  maxFileSize: parseInt(import.meta.env.VITE_MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024,
  allowedFileExtensions: [
    '.md', '.txt', '.log', '.json', '.csv',
    '.pdf', '.doc', '.docx'
  ],
};

export default config;
```

**File: `.env.example`**

```bash
# Backend API endpoint
VITE_API_URL=https://api.faultmaven.ai

# Upload limits
VITE_MAX_FILE_SIZE_MB=50
```

**Commit:**

```bash
git add src/lib/config.ts .env.example
git commit -m "feat: Add configuration with environment variables"
```

### Step 2.7: Create Router and Pages

**File: `src/App.tsx`**

Copy from MIGRATION_GUIDE_V2.md lines 1100-1146.

**File: `src/pages/LoginPage.tsx`**

Create a simple login page:

```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { devLogin } from '../lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username || username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    setLoading(true);
    try {
      const auth = await devLogin(username.trim());
      localStorage.setItem('faultmaven_auth_token', auth.access_token);
      localStorage.setItem('faultmaven_session_id', auth.session_id);
      navigate('/kb');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white border rounded-lg p-8 w-full max-w-md shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          FaultMaven Dashboard
        </h1>

        <form onSubmit={handleLogin}>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg mb-4"
            disabled={loading}
            autoFocus
          />

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**File: `src/pages/NotFoundPage.tsx`**

```typescript
import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-800 mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-8">Page not found</p>
        <Link
          to="/kb"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Go to Knowledge Base
        </Link>
      </div>
    </div>
  );
}
```

**Commit:**

```bash
git add src/App.tsx src/pages/
git commit -m "feat: Add routing and page components

- App.tsx with React Router
- LoginPage with dev login support
- NotFoundPage for 404s
- Protected routes for authenticated pages"
```

### Step 2.8: Update Main Entry

**File: `src/main.tsx`**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### Step 2.9: Create Dockerfile

**File: `Dockerfile`**

See MIGRATION_GUIDE_V2.md for complete Dockerfile (not included in this snippet for brevity).

**File: `nginx.conf`**

See MIGRATION_GUIDE_V2.md for complete nginx config.

**Commit:**

```bash
git add Dockerfile nginx.conf
git commit -m "feat: Add Docker support with Nginx

- Multi-stage build (builder + production)
- Nginx serves static files
- SPA routing support
- Security headers (CSP, X-Frame-Options, etc.)
- Gzip compression"
```

### Step 2.10: Update Package.json

**File: `package.json`**

```json
{
  "name": "faultmaven-dashboard",
  "version": "1.0.0",
  "description": "Knowledge Base management dashboard for FaultMaven",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx"
  }
}
```

### Step 2.11: Build Docker Image

```bash
# Build Docker image
docker build -t faultmaven/dashboard:latest .

# Test locally
docker run -d -p 3000:80 \
  -e VITE_API_URL=http://localhost:8000 \
  faultmaven/dashboard:latest

# Open browser to http://localhost:3000
# Should see login page
```

### Step 2.12: Create docker-compose for Testing

**File: `docker-compose.test.yml`**

```yaml
version: '3.8'

services:
  dashboard:
    build: .
    ports:
      - "3000:80"
    environment:
      - VITE_API_URL=http://localhost:8000
      - VITE_MAX_FILE_SIZE_MB=50
```

**Test:**

```bash
docker-compose -f docker-compose.test.yml up
# Visit http://localhost:3000
```

### Step 2.13: Update README

**File: `README.md`**

```markdown
# FaultMaven Dashboard

Knowledge Base management dashboard for FaultMaven.

## Features

- 📚 **Knowledge Base Management:** Upload, organize, search documents
- 🔍 **Semantic Search:** Find relevant runbooks quickly
- 👥 **Admin KB:** Organization-wide knowledge (enterprise only)
- 📊 **Analytics:** Track KB usage (enterprise only)

## Development

```bash
npm install
npm run dev       # Start dev server on http://localhost:5173
npm run build     # Production build
```

## Docker Deployment

### Build Image

```bash
docker build -t faultmaven/dashboard:latest .
```

### Run Container

```bash
docker run -d \
  -p 3000:80 \
  -e VITE_API_URL=https://api.faultmaven.ai \
  faultmaven/dashboard:latest
```

### With Backend (docker-compose)

See [faultmaven-backend](https://github.com/faultmaven/faultmaven-backend) for full stack deployment.

## Environment Variables

- `VITE_API_URL`: Backend API endpoint
- `VITE_MAX_FILE_SIZE_MB`: Maximum file upload size

## License

MIT
```

**Commit:**

```bash
git add README.md
git commit -m "docs: Add comprehensive README"
```

### Step 2.14: Push to GitHub

```bash
git push origin main

# Tag release
git tag v1.0.0
git push origin v1.0.0
```

### Step 2.15: Publish Docker Image (Optional)

```bash
# Login to Docker Hub
docker login

# Tag image
docker tag faultmaven/dashboard:latest yourdockerhubuser/faultmaven-dashboard:latest

# Push to Docker Hub
docker push yourdockerhubuser/faultmaven-dashboard:latest
```

---

## Task 3: Update Backend

**Goal:** Add `/v1/meta/capabilities` endpoint to backend

### Step 3.1: Add Capabilities Endpoint

**File: `backend/api/v1/meta.py`** (create if doesn't exist)

See MIGRATION_GUIDE_V2.md lines 311-399 for complete implementation.

### Step 3.2: Update Backend Config

**File: `backend/config.py`**

Add new settings:

```python
class Settings(BaseSettings):
    DEPLOYMENT_MODE: str = "self-hosted"  # or "enterprise"
    DASHBOARD_URL: str | None = None
    MAX_UPLOAD_SIZE_MB: int = 10

    class Config:
        env_file = ".env"
```

### Step 3.3: Register Router

**File: `backend/main.py`**

```python
from api.v1.meta import router as meta_router

app.include_router(meta_router)
```

### Step 3.4: Update CORS

**File: `backend/main.py`**

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://app.faultmaven.ai",        # Dashboard (enterprise)
        "http://localhost:3000",             # Dashboard (self-hosted)
        "http://localhost:5173",             # Dashboard (dev)
        "chrome-extension://*",              # Extension
        "moz-extension://*",                 # Firefox
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Step 3.5: Test Endpoint

```bash
# Start backend
python -m uvicorn main:app --reload

# Test capabilities endpoint
curl http://localhost:8000/v1/meta/capabilities

# Should return JSON with deployment_mode, dashboardUrl, etc.
```

---

## Task 4: Testing

### Test 4.1: Self-Hosted Integration Test

**Setup:**

```bash
# Terminal 1: Start backend
cd faultmaven-backend
docker-compose up

# Terminal 2: Verify services
docker-compose ps
# All should show "Up"

# Terminal 3: Test capabilities
curl http://localhost:8000/v1/meta/capabilities
# Should return self-hosted config
```

**Test Extension:**

1. Load extension in Chrome
2. Should show welcome screen
3. Choose "Self-Hosted"
4. Settings should auto-open
5. API Endpoint should be http://localhost:8000
6. Click "Test Connection" → should show success
7. Click "Manage KB" button → should open http://localhost:3000
8. Login to dashboard
9. Upload a test document
10. Chat in extension → verify RAG uses uploaded doc

### Test 4.2: Enterprise Simulation Test

**Setup:**

```bash
# Set backend to enterprise mode
# In backend/.env:
DEPLOYMENT_MODE=enterprise
DASHBOARD_URL=http://localhost:3000
MAX_UPLOAD_SIZE_MB=50

# Restart backend
docker-compose restart backend
```

**Test:**

1. Clear extension storage (reset first-run)
2. Reload extension
3. Welcome screen → choose "Enterprise Cloud"
4. Should connect to localhost:8000 (for testing)
5. Capabilities should show enterprise mode
6. "Manage KB" button → should try to open localhost:3000
7. Dashboard should show admin features (if admin user)

---

## Task 5: Deployment

### Deploy 5.1: Publish Extension to Chrome Web Store

```bash
cd faultmaven-copilot
pnpm build
pnpm zip

# Upload .output/faultmaven-copilot-0.4.0-chrome.zip
# to Chrome Web Store Developer Dashboard
```

### Deploy 5.2: Deploy Dashboard to Vercel

```bash
cd faultmaven-dashboard

# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard:
# VITE_API_URL=https://api.faultmaven.ai
# VITE_MAX_FILE_SIZE_MB=50

# Configure custom domain: app.faultmaven.ai
```

### Deploy 5.3: Deploy Backend

Deploy backend with:
- `DEPLOYMENT_MODE=enterprise`
- `DASHBOARD_URL=https://app.faultmaven.ai`

---

## Summary Checklist

### Task 1: faultmaven-copilot ✅
- [x] Create public GitHub repo
- [x] Copy original codebase
- [x] Remove KB components
- [x] Add capabilities manager
- [x] Add welcome screen
- [x] Update SidePanelApp
- [x] Update navigation
- [x] Add settings page
- [x] Build and test
- [x] Push to GitHub

### Task 2: faultmaven-dashboard ✅
- [x] Create public GitHub repo
- [x] Initialize Vite + React project
- [x] Copy KB components from extension
- [x] Adapt for web environment
- [x] Create routing
- [x] Add Dockerfile
- [x] Build Docker image
- [x] Test locally
- [x] Push to GitHub

### Task 3: Update Backend ✅
- [x] Add capabilities endpoint
- [x] Update CORS
- [x] Test endpoint

### Task 4: Testing ✅
- [x] Self-hosted integration test
- [x] Enterprise simulation test

### Task 5: Deployment 🔄
- [ ] Publish extension to Chrome Web Store
- [ ] Deploy dashboard to Vercel
- [ ] Deploy backend with enterprise config

---

**End of Execution Guide**

For architecture details and design rationale, see [MIGRATION_GUIDE_V2.md](./MIGRATION_GUIDE_V2.md).
