import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist',
      'out',
      'build',
      'node_modules',
      'playwright-report',
      'test-results',
      '.e2e-user-data',
      'resources',
      'src',
    ],
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
]
