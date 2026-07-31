import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'

// Flat config. Genuine-bug rules are errors (rules-of-hooks, undefined refs);
// style/unused noise is a warning, and the gate runs at --max-warnings 0
// (scripts/lint.sh), so a warning is something to fix rather than to live with.
//
// eslint-plugin-react is here for TWO rules, both closing the same blindness: ESLint's
// scope analysis creates no reference for a JSX identifier, so core rules cannot see JSX
// at all. Neither rule is cosmetic and neither has a substitute.
//
//   react/jsx-uses-vars  — "defined, used only in JSX, wrongly reported unused". Acting
//     on two such reports renamed props out from under their JSX and blanked the Pond
//     stats screen and the controls panel, with the build, the lint gate and 818 unit
//     tests all green. Only the e2e caught it.
//   react/jsx-no-undef   — the inverse, and the more dangerous one: "referenced in JSX,
//     never defined". `no-undef` cannot see <Missing />, so renaming an import and
//     missing one call site throws ReferenceError during render — a blank screen, with
//     nothing red anywhere. That is v0.10.0's bug in a place the gate had no coverage.
//
// The plugin's `recommended` set is deliberately NOT taken: react/prop-types alone fires
// 938 times in this propTypes-free codebase. Name individual rules.
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
      // Both teach ESLint to see JSX. Not style rules — see the note above.
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      // varsIgnorePattern is '^_' and not '^[A-Z_]': the capital-letter escape was only
      // ever a workaround for the JSX blindness above, and with jsx-uses-vars in place it
      // does nothing except hide genuinely dead component imports and dead constants.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
