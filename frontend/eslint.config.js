import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'

// Flat config. Genuine-bug rules are errors (rules-of-hooks, undefined refs);
// style/unused noise is a warning, and the gate runs at --max-warnings 0
// (scripts/lint.sh), so a warning is something to fix rather than to live with.
//
// eslint-plugin-react is here for ONE rule, and it is not cosmetic:
// `react/jsx-uses-vars`. Without it `no-unused-vars` cannot see a JSX reference, so
// a component prop used only as <Icon /> is reported as unused. That is a lie with
// teeth — acting on two such reports renamed the props out from under the JSX and
// blanked the Pond stats screen and the controls panel, with the build, the lint gate
// and 818 unit tests all green. Only the e2e caught it.
export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'public/emulatorjs/**', 'src-tauri/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Marks JSX-referenced identifiers as used. Not a style rule — see the note above.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // The service worker runs in the ServiceWorker global scope.
  {
    files: ['src/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  // Build-time config runs under Node (reads process.env / node:fs), not the browser.
  {
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Vitest test files: test globals + node.
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly',
        vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
  },
]
