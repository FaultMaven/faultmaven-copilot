import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      // ============================================
      // LOGGING RULES - Enforced (Migration Complete)
      // ============================================

      // Enforce structured logging - no raw console.log/debug/info
      // Only console.warn and console.error are allowed
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Provide specific guidance for each console method
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
          message: 'Use createLogger() instead of console.log. Import from ~/lib/utils/logger'
        },
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='debug']",
          message: 'Use log.debug() from createLogger instead of console.debug'
        },
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='info']",
          message: 'Use log.info() from createLogger instead of console.info'
        }
      ],

      // ============================================
      // TypeScript Rules
      // ============================================
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',

      // ============================================
      // React Rules
      // ============================================
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // Disable base rules that conflict with TypeScript
      'no-undef': 'off',
      'no-unused-vars': 'off'
    }
  },
  {
    ignores: [
      'node_modules/',
      '.output/',
      '.wxt/',
      'dist/',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
      'scripts/'
    ]
  }
];
