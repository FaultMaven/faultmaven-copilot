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
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
};
