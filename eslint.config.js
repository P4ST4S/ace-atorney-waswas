import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx'];

/** Import groups used to enforce module boundaries (see docs/ARCHITECTURE.md §4). */
const OUTER = {
  content: ['**/content', '**/content/**'],
  runtime: ['**/runtime', '**/runtime/**'],
  ui: ['**/ui', '**/ui/**'],
  dev: ['**/dev', '**/dev/**'],
  engine: ['**/engine', '**/engine/**'],
};

export default defineConfig(
  { ignores: ['dist', 'public/generated', 'assets', 'playwright-report', 'test-results', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['scripts/**/*.ts', '*.config.ts', 'eslint.config.js', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The engine is pure: no outer layers, no framework, no clock, no randomness, no DOM.
    files: ['src/engine/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: [...OUTER.content, ...OUTER.runtime, ...OUTER.ui, ...OUTER.dev], message: 'The engine must not import outer layers.' },
          { group: ['react', 'react-dom', 'react/*', 'zustand', 'howler', 'zod', 'zod/*'], message: 'The engine must stay framework-free.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'Date', message: 'The engine must be deterministic.' },
        { name: 'window', message: 'The engine has no DOM.' },
        { name: 'document', message: 'The engine has no DOM.' },
        { name: 'setTimeout', message: 'The engine has no timers.' },
      ],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'The engine must be deterministic.' }],
    },
  },
  {
    // Content may only import engine *types*; values come from its own DSL.
    files: ['src/content/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: OUTER.engine, allowTypeImports: true, message: 'Content may only import engine types.' },
          { group: [...OUTER.runtime, ...OUTER.ui, ...OUTER.dev, 'react', 'react-dom'], message: 'Content must not import presentation layers.' },
        ],
      }],
    },
  },
  {
    files: ['src/runtime/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{ group: [...OUTER.ui, ...OUTER.dev], message: 'The runtime must not depend on the UI.' }],
      }],
    },
  },
  {
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    ignores: TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: OUTER.engine, allowTypeImports: true, message: 'The UI talks to the Director; it may only import engine types.' },
          { group: OUTER.content, allowTypeImports: true, message: 'The UI must not depend on chapter content.' },
        ],
      }],
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
