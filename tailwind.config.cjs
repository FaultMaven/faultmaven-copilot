/**
 * The extension's Tailwind config.
 *
 * The theme is NOT here. It ships with the UI it belongs to
 * (`@faultmaven/copilot-ui/tailwind-preset.cjs`) so that the Dashboard renders
 * the same tokens from the same file rather than a copy that drifts. What is
 * left is the only thing that is genuinely this host's: where its own files are.
 */
const copilotUiPreset = require('@faultmaven/copilot-ui/tailwind-preset.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [copilotUiPreset],
  // The package globs its own sources in the preset. These are the extension's:
  // its entry points, its host implementation and its sign-in screens.
  //
  // NOT `./src/**`, which swept in `src/test/**`. Tailwind extracts candidate
  // class names from raw TEXT, so a class named in a test — even inside a
  // comment — was emitted into the shipped stylesheet: dead css for users, and
  // an artifact digest that moved whenever a test was edited. Observed: a doc
  // comment mentioning `hover:bg-fm-accent-strong` added that utility to the
  // bundle and changed every content-hashed chunk downstream of the stylesheet.
  //
  // AND the package's own sources, spread from the preset. `content` is the one
  // key Tailwind does NOT merge across presets — the config's array replaces it
  // — so a host that only lists its own files emits no class the shared UI
  // uses. Nothing throws: the elements render unstyled. Until this line the
  // extension's stylesheet was missing them and surviving on the coincidence
  // that `./src/**` also swept the tests, which mention many of the same
  // classes.
  content: [
    "./src/entrypoints/**/*.{js,jsx,ts,tsx}",
    "./src/extension/**/*.{js,jsx,ts,tsx}",
    ...copilotUiPreset.content,
  ],
};
