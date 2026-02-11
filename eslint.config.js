import vue from 'eslint-plugin-vue'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'node_modules.win-bak-*/**',
    ],
  },

  // TypeScript (incl. tests)
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },

  // Vue SFC template rules (security guard)
  {
    files: ['**/*.vue'],
    plugins: {
      vue,
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // Disallow direct HTML sinks by default; use SafeText for untrusted strings.
      'vue/no-v-html': 'error',
    },
  },

  // SafeText is the only allowed `v-html` sink (it pre-escapes content).
  {
    files: ['src/components/SafeText.vue'],
    rules: {
      'vue/no-v-html': 'off',
    },
  },
]
