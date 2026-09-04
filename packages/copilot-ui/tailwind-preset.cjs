/**
 * The FaultMaven theme, as a Tailwind preset.
 *
 * It ships with the UI because it IS part of the UI: `bg-fm-canvas` is not a
 * colour a host chooses, it is what this component tree says it renders on. A
 * host that redefined it would be forking the design, and a host that simply
 * did not have it would render the element unstyled — a missing Tailwind token
 * is not an error, the class is just never emitted, so nothing throws and
 * nothing turns red.
 *
 * That is not hypothetical: before this preset existed, the two repositories
 * hand-maintained near-copies of these tokens and had already drifted —
 * `bg-fm-bg`, `font-fm-sans` and `font-fm-mono` were used by the shared UI and
 * absent from the Dashboard's config.
 *
 * A host consumes it and adds nothing but its own `content` globs:
 *
 *     module.exports = {
 *       presets: [require('@faultmaven/copilot-ui/tailwind-preset.cjs')],
 *       content: [ ...the host's own sources..., './node_modules/@faultmaven/copilot-ui/**\/*.{ts,tsx}' ],
 *     };
 *
 * `content` is the host's because only the host knows where its files are; the
 * package's own glob has to be in it or every class below is purged out of the
 * bundle. `preset-tokens.test.ts` is what makes that failure loud.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  // WHERE THE PACKAGE'S FILES ARE, for a host to spread into its own `content`:
  //
  //     content: [ ...its own globs, ...preset.content ]
  //
  // It has to be spread. `content` is the one key Tailwind does NOT merge
  // across presets — a config's array REPLACES it — so listing it here does
  // nothing on its own. A host that omits it emits no class the shared UI uses
  // and every element renders unstyled, with nothing thrown.
  content: [__dirname + '/shared/**/*.{js,jsx,ts,tsx}', __dirname + '/lib/**/*.{js,jsx,ts,tsx}'],
  darkMode: "class",
  theme: {
    extend: {
      /*
       * =============================================
       *  FaultMaven Copilot — Charcoal Theme Tokens
       *  Base: Stripe / Tailwind Slate Dark
       * =============================================
       */

      colors: {
        /* --- Surface Layers (3-tier elevation) --- */
        fm: {
          // Legacy background token, mapped to canvas for mock UI compatibility
          "bg": "#0F172A",
          // Layer 0 — Deepest: sidebar, panels
          "base": "#0B1222",
          // Layer 1 — Canvas: main content background
          "canvas": "#0F172A",
          // Layer 2 — Surface: cards, response blocks, top/bottom bars
          "surface": "#1E293B",
          // Layer 2.5 — Surface alt: input field backgrounds
          "surface-alt": "#172033",
          // Layer 3 — Elevated: user bubbles, hover states, popovers
          "elevated": "#243044",

          /* --- Borders (use elevation first, borders second) --- */
          "border": "rgba(51, 65, 85, 0.5)",       // default
          "border-subtle": "rgba(51, 65, 85, 0.3)", // minimal separation
          "border-strong": "#334155",                // explicit dividers

          /* --- Text Hierarchy --- */
          "text-primary": "#F1F5F9",    // headings, user input, emphasis
          "text-secondary": "#94A3B8",  // body text, descriptions
          "text-tertiary": "#64748B",   // timestamps, labels, placeholders

          /* --- Accent (Indigo) --- */
          "accent": "#818CF8",
          // The far end of the accent gradient below. Named because the UI asks
          // for it — `hover:bg-fm-accent-strong` on the primary button — and an
          // unnamed token is a hover state that silently does nothing.
          "accent-strong": "#6366F1",
          "accent-soft": "rgba(129, 140, 248, 0.1)",
          "accent-border": "rgba(129, 140, 248, 0.25)",
          "accent-hover": "rgba(129, 140, 248, 0.18)",

          /* --- Severity / Status --- */
          "critical": "#F87171",
          "critical-bg": "rgba(248, 113, 113, 0.1)",
          "critical-border": "rgba(248, 113, 113, 0.25)",

          "warning": "#FBBF24",
          "warning-bg": "rgba(251, 191, 36, 0.1)",
          "warning-border": "rgba(251, 191, 36, 0.25)",

          "success": "#34D399",
          "success-bg": "rgba(52, 211, 153, 0.1)",
          "success-border": "rgba(52, 211, 153, 0.25)",

          "info": "#60A5FA",
          "info-bg": "rgba(96, 165, 250, 0.08)",
          "info-border": "rgba(96, 165, 250, 0.2)",

          /* --- Inline Code --- */
          "code": "#CBD5E1",
          "code-bg": "rgba(148, 163, 184, 0.12)",
          "code-border": "rgba(148, 163, 184, 0.2)",

          /* --- Code Blocks --- */
          "codeblock": "#0B1120",
          "codeblock-border": "rgba(51, 65, 85, 0.5)",
          "codeblock-text": "#CBD5E1",
        },
      },

      /* --- Typography --- */
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
        "fm-sans": ['"DM Sans"', "system-ui", "sans-serif"],
        "fm-mono": ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },

      fontSize: {
        /* Semantic scale for FaultMaven UI */
        "fm-xs": ["10px", { lineHeight: "1.4" }],  // meta labels, section headers
        "fm-sm": ["11px", { lineHeight: "1.4" }],  // timestamps, status, chips
        "fm-code": ["12px", { lineHeight: "1.5" }],  // code snippets, sidebar labels
        "fm-body": ["13px", { lineHeight: "1.5" }],  // sidebar items, secondary text
        "fm-chat": ["14px", { lineHeight: "1.5" }],  // chat text, main content
        "fm-title": ["15px", { lineHeight: "1.4" }],  // case title, top bar heading
      },

      /* --- Spacing --- */
      spacing: {
        "fm-sidebar": "240px",
      },

      /* --- Border Radius --- */
      borderRadius: {
        "fm-card": "10px",
        "fm-btn": "6px",
        "fm-chip": "4px",
        "fm-avatar": "5px",
        "fm-input": "10px",
      },

      /* --- Box Shadows --- */
      boxShadow: {
        "fm-glow": "0 4px 14px 0 rgba(99, 102, 241, 0.39)",
        "fm-card": "0 1px 3px 0 rgba(0, 0, 0, 0.2)",
      },

      /* --- Background Gradients --- */
      backgroundImage: {
        "fm-accent-gradient": "linear-gradient(135deg, #818CF8, #6366F1)",
      },

      /* --- Transitions --- */
      transitionDuration: {
        "fm-fast": "150ms",
        "fm-normal": "200ms",
        "fm-slow": "250ms",
      },

      /* --- Keyframes --- */
      keyframes: {
        "fm-fade-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "0.2", transform: "scale(0.8)" },
          "50%": { opacity: "1", transform: "scale(1.15)" },
        },
        "slide-in-from-top": {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "fm-fade-in": "fm-fade-in 200ms ease",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "slide-in-from-top": "slide-in-from-top 0.2s ease-out",
      },

      /* --- Width constraints --- */
      maxWidth: {
        "fm-content": "780px",
      },
    },
  },
  plugins: [],
};
