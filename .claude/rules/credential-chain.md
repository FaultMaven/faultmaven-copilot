---
paths:
  - "src/extension/auth/**"
  - "src/extension/host/session-credential.ts"
  - "src/extension/host/auth-state.ts"
  - "src/extension/ExtensionApp.tsx"
  - "src/entrypoints/background.ts"
  - "src/entrypoints/options/main.tsx"
---

These files take part in the credential chain (verdict, act-site, teardown,
sign-out). The contract is `src/extension/auth/CLAUDE.md`; read it before
changing any of them.
