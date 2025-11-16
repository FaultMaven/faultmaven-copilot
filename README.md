# FaultMaven Copilot – WXT Browser Extension

[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](./package.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE.md)
[![Framework](https://img.shields.io/badge/framework-WXT-orange.svg)](https://wxt.dev/)
[![React](https://img.shields.io/badge/React-19+-61DAFB.svg?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4+-38B2AC.svg?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Testing](https://img.shields.io/badge/testing-Vitest-6E56CF.svg?logo=vitest&logoColor=white)](https://vitest.dev/)

**FaultMaven Copilot** is an AI-powered troubleshooting assistant embedded directly in your browser as a side panel. It provides **engineers—especially in SRE and DevOps roles**—with in-context help, analyzes web content, and enables users to interact with the FaultMaven AI to diagnose and resolve issues efficiently.

This extension is built using the modern **WXT framework**, with **React 19+**, **Tailwind CSS**, **TypeScript**, and comprehensive **testing infrastructure**.

-----

## ✨ Key Features

  * 💬 **Conversational Troubleshooting**: Engage in a stateful, interactive dialogue with the FaultMaven AI. Submit logs, ask questions, and receive guided insights with findings, recommendations, and confidence scores to pinpoint the root cause of issues.
  * 🌐 **Contextual Data Analysis**: Provide evidence to the AI directly from your workflow.
      * Analyze the content of your current browser page.
      * Paste logs, metrics, or error messages directly into the chat.
      * Upload files for immediate analysis with insights.
  * 🔄 **Session Management**: Maintain conversation context across browser sessions with automatic session persistence and heartbeat management.
  * 🗂️ **Centralized Knowledge Base**: The Copilot features a dedicated tab to build and manage your team's knowledge base.
      * **Upload Documents**: Easily upload runbooks, post-mortems, and other documentation (MD, TXT, LOG, JSON, CSV, PDF, DOC, DOCX) via drag-and-drop.
      * **Monitor Ingestion Status**: Track the real-time status of your uploads with clear visual indicators for "Processing," "Indexed," or "Error".
      * **Manage Knowledge**: View and delete documents to ensure your knowledge base remains current and relevant.
  * 🔒 **Privacy-First Design**: All interactions are designed with security in mind, ensuring sensitive data is handled appropriately by the backend's PII redaction services.
  * ♿ **Accessibility First**: Built with WCAG 2.1 AA compliance, featuring keyboard navigation, screen reader support, and proper ARIA labels.
  * 🛡️ **Error Resilience**: React Error Boundaries provide crash protection and graceful error recovery throughout the application.
  * 📝 **Rich Markdown Rendering**: AI responses are rendered with headings, lists, code blocks, and inline formatting for readability.

-----

## 🛠️ Tech Stack

| Component         | Details                                                                              |
| :---------------- | :----------------------------------------------------------------------------------- |
| **Framework** | [WXT](https://wxt.dev/) v0.20.6 (Vite-based Web Extension Toolkit)                     |
| **UI** | React 19+                                                                            |
| **Styling** | Tailwind CSS v3                                                                      |
| **Language** | TypeScript                                                                           |
| **Testing** | Vitest + React Testing Library                                                      |
| **Package Manager** | pnpm                                                                                 |
| **Browser APIs** | Manifest V3, Side Panel API, `chrome.storage`, `chrome.runtime.messaging`, `chrome.tabs` |

-----

## 🚀 Getting Started

### Prerequisites

  * [Node.js](https://nodejs.org/) (v20+ recommended)
  * [pnpm](https://pnpm.io/installation) (v8+ recommended)
  * A running instance of the **FaultMaven Backend API**.

### Setup

1.  **Run the Backend First**: The Copilot requires a running FaultMaven API server to function. Ensure your backend is running at `http://api.faultmaven.local:8000` or update the configuration accordingly.

2.  **Clone this Repository**:

    ```bash
    git clone https://github.com/your-org/faultmaven-copilot.git
    cd faultmaven-copilot
    ```

3.  **Install Dependencies**:

    ```bash
    pnpm install
    ```

    This command will also run `wxt prepare` to set up the development environment.

4.  **Configure Environment Variables**: Create a `.env.local` file from the example template:

    ```bash
    cp .env.example .env.local
    ```

    Edit `.env.local` to configure your settings:

    ```bash
    # Backend API endpoint (required)
    VITE_API_URL=http://api.faultmaven.local:8000

    # Input limits (optional - uncomment to customize)
    #VITE_DATA_MODE_LINES=100        # Lines to trigger data upload mode
    #VITE_MAX_QUERY_LENGTH=10000     # Max input characters
    #VITE_MAX_FILE_SIZE_MB=10        # Max file upload size in MB
    ```

    **Available Configuration Options:**
    - **`VITE_API_URL`**: Backend API endpoint (default: `http://127.0.0.1:8000`)
    - **`VITE_DATA_MODE_LINES`**: Smart detection threshold - lines that trigger data upload mode (default: `100`)
    - **`VITE_MAX_QUERY_LENGTH`**: Maximum characters in text input (default: `10000`)
    - **`VITE_MAX_FILE_SIZE_MB`**: Maximum file upload size in megabytes (default: `10`)

    See [`.env.example`](./.env.example) for complete documentation.

5.  **Fonts**: The UI uses the Inter typeface for crisp readability.

    - Inter is bundled via `@fontsource/inter` and enabled by Tailwind `font-sans`.

### Development Workflow

Start the dev server, which enables Hot Module Replacement (HMR) for a fast development experience.

```bash
pnpm dev
```

### Testing

Run the comprehensive test suite to ensure code quality:

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

### Load the Extension in Chrome

1.  Navigate to `chrome://extensions` in your browser.
2.  Enable **Developer mode** using the toggle in the top-right corner.
3.  Click **Load unpacked**.
4.  Select the `.output/chrome-mv3-dev/` folder from this project's directory.

The **FaultMaven Copilot** icon will now appear in your browser toolbar, and the side panel will be available.

-----

## 📦 Production and Packaging

  * **Create an optimized production build**: `pnpm build`
  * **Package for store submission**: `pnpm zip`

-----

## 📂 Project Structure

The project follows a standard WXT structure, organizing code by its function within the browser extension.

```
faultmaven-copilot/
├── public/                  # Static assets (icons)
├── src/                     # Main application source
│   ├── entrypoints/         # WXT entrypoints (background, sidepanel)
│   ├── lib/                 # Core logic (API clients, utils)
│   ├── shared/              # Reusable React components and UI
│   │   └── ui/
│   │       ├── SidePanelApp.tsx     # Main app with tabbed interface
│   │       ├── KnowledgeBaseView.tsx  # Knowledge base management view
│   │       └── components/          # Reusable UI components
│   │           ├── ErrorBoundary.tsx    # React error boundary
│   │           ├── LoadingSpinner.tsx   # Loading states and spinners
│   │           └── AccessibleComponents.tsx # Accessible UI components
│   └── test/                # Test files and setup
│       ├── setup.ts         # Test configuration and mocks
│       ├── components/      # Component tests
│       └── api/            # API function tests
├── wxt.config.ts            # WXT configuration file
├── vitest.config.ts         # Vitest testing configuration
└── package.json
```

-----

## 🧪 Testing

The project includes comprehensive testing infrastructure:

### Test Coverage
- **Component Tests**: LoadingSpinner, ErrorBoundary, AccessibleComponents
- **API Tests**: Session management, query processing, data upload
- **Integration Tests**: User interactions and error scenarios

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

-----

## ♿ Accessibility

The extension is built with accessibility in mind:

- **WCAG 2.1 AA Compliance**: Meets web accessibility standards
- **Keyboard Navigation**: Full keyboard support for all features
- **Screen Reader Support**: Proper ARIA labels and semantic HTML
- **Focus Management**: Logical tab order and focus indicators
- **High Contrast**: Support for high contrast mode

-----

## 🤝 Contributing

We welcome contributions from the community! We encourage you to open issues for bugs, feature requests, and suggestions. If you'd like to contribute code, please see our [Contributing Guidelines](https://www.google.com/search?q=CONTRIBUTING.md) for details on our development process and how to submit a pull request.

### Development Guidelines
- Write tests for new features
- Ensure accessibility compliance
- Follow TypeScript strict mode
- Use the provided error boundaries
- Test with screen readers and keyboard navigation

-----

## 📜 License

This project is licensed under the **Apache-2.0 License**. See the `LICENSE.md` file for full terms.