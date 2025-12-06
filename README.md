# FaultMaven Copilot

> **Part of [FaultMaven](https://github.com/FaultMaven/faultmaven)** —
> The AI-Powered Troubleshooting Copilot

**The Browser Extension for In-Flow Troubleshooting**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

> **FaultMaven Copilot** is the browser-based interface for the [FaultMaven Platform](https://github.com/FaultMaven/faultmaven). It overlays AI troubleshooting intelligence directly onto your existing tools (AWS Console, Datadog, Grafana, or localhost).

---

## About FaultMaven

FaultMaven is an AI-powered troubleshooting copilot that correlates your live telemetry with your runbooks, docs, and past fixes. It delivers answers grounded in your actual system—not generic guesses.

**Learn More:**
- **[Product Overview](https://faultmaven.ai/product)** — See what FaultMaven can do
- **[Use Cases](https://faultmaven.ai/use-cases)** — Real-world troubleshooting scenarios
- **[Main Repository](https://github.com/FaultMaven/faultmaven)** — Architecture and documentation

---

## ⚡ Capabilities

This extension connects to your FaultMaven backend (self-hosted or Cloud) to provide:

- **Context Capture**: Automatically scrapes relevant logs, stack traces, and DOM elements from your active tab
- **In-Flow Chat**: Diagnose issues without leaving your dashboard or console
- **Deep Linking**: References your Knowledge Base articles directly in the chat
- **Session Persistence**: Maintain conversation context across browser sessions
- **Knowledge Base Management**: Upload and manage runbooks, post-mortems, and documentation
- **Rich Rendering**: AI responses displayed with proper formatting, code blocks, and syntax highlighting

---

## 🚀 Getting Started

### Installation

**Option 1: Manual Load (Development)**

Download the latest `faultmaven-copilot.zip` from [Releases](https://github.com/FaultMaven/faultmaven-copilot/releases) or build from source.

**Chrome/Edge:**

1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3/` folder

**Firefox:**

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file in the `.output/firefox-mv3/` folder

### Connection

By default, the extension tries to connect to **FaultMaven Cloud**.

**To use with self-hosted:**

1. Click the extension icon
2. Go to **Settings**
3. Change API Endpoint to: `http://localhost:8090` (or your gateway URL)

> **Need the backend?** Deploy FaultMaven in 5 minutes: [Quick Start](https://github.com/FaultMaven/faultmaven#quick-start)

---

## 🛠️ Development

Built with [WXT](https://wxt.dev/), React, and Vite.

```bash
# 1. Clone
git clone https://github.com/FaultMaven/faultmaven-copilot.git
cd faultmaven-copilot

# 2. Install dependencies
npm install

# 3. Run in dev mode (Chrome)
npm run dev

# 4. Build for production
npm run build

# 5. Package for distribution
npm run zip
```

**Tech Stack:**

- **Framework**: [WXT](https://wxt.dev/) (Vite-based Web Extension Toolkit)
- **UI**: React 19+
- **Styling**: Tailwind CSS
- **Language**: TypeScript
- **Testing**: Vitest + React Testing Library
- **Package Manager**: npm / pnpm

---

## 🤝 Contributing

We welcome contributions to the FaultMaven Copilot! Whether it's adding new site integrations, improving the UI, or fixing bugs, your help makes FaultMaven better for everyone.

**Note:** This repository contains only the browser extension UI. For backend features (AI agent, knowledge base, microservices), see the main [FaultMaven repository](https://github.com/FaultMaven/faultmaven).

**Getting Started:**
- Check out [`good-first-issue`](https://github.com/search?q=org%3AFaultMaven+label%3A%22good+first+issue%22+state%3Aopen+repo%3Afaultmaven-copilot) tags for beginner-friendly tasks
- See our [Contributing Guide](https://github.com/FaultMaven/.github/blob/main/CONTRIBUTING.md) for detailed guidelines
- Join [GitHub Discussions](https://github.com/FaultMaven/faultmaven/discussions) to share ideas

---

## 📄 License

This project is licensed under the **Apache 2.0 License** - see the [LICENSE](LICENSE) file for details.

---

## 🔗 Related Projects

The FaultMaven ecosystem includes:

- **[faultmaven](https://github.com/FaultMaven/faultmaven)** - Main repository with microservices backend
- **[faultmaven-dashboard](https://github.com/FaultMaven/faultmaven-dashboard)** - Web-based dashboard UI
- **[faultmaven-deploy](https://github.com/FaultMaven/faultmaven-deploy)** - Deployment configurations and tooling
- **[faultmaven-website](https://github.com/FaultMaven/faultmaven-website)** - Official website

---

## Support

- **Discussions:** [GitHub Discussions](https://github.com/FaultMaven/faultmaven/discussions)
- **Issues:** [GitHub Issues](https://github.com/FaultMaven/faultmaven-copilot/issues)

---

**FaultMaven** — Your AI copilot for troubleshooting.
