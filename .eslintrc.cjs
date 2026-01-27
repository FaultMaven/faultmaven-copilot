module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended'
  ],
  env: {
    browser: true,
    es2020: true,
    node: true
  },
  rules: {
    // ============================================
    // LOGGING RULES - Staged Enforcement Strategy
    // ============================================

    // Stage 1: Warn on raw console.log (non-breaking)
    // This identifies all locations without failing CI/CD
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Stage 2: Provide specific guidance via no-restricted-syntax
    // Shows IDE tooltip suggesting createLogger alternative
    'no-restricted-syntax': [
      'warn',
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
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-require-imports': 'off',

    // ============================================
    // React Rules
    // ============================================
    'react/react-in-jsx-scope': 'off', // Not needed in React 17+
    'react/prop-types': 'off', // Using TypeScript for type checking
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  ignorePatterns: [
    'node_modules/',
    '.output/',
    '.wxt/',
    'dist/',
    '*.config.js',
    '*.config.cjs',
    '*.config.mjs',
    'scripts/'
  ]
};
