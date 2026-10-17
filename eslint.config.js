// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'supabase/functions/*', 'node_modules/*', '.expo/*', 'public/ocr/*'],
  },
  {
    // iPhone Safari before iOS 16.4 cannot parse regex lookbehind: one such literal makes the
    // whole web bundle fail to load (blank page). Keep it out of app code.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[regex.pattern=/\\(\\?<[=!]/]', message: 'Regex lookbehind breaks Safari before iOS 16.4 — rewrite without (?<= / (?<!.' },
        { selector: "NewExpression[callee.name='RegExp'] > Literal[value=/\\(\\?<[=!]/]", message: 'Regex lookbehind breaks Safari before iOS 16.4 — rewrite without (?<= / (?<!.' },
      ],
    },
  },
]);
