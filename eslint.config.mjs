import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/dist-bundle/**',
      '**/sea/**',
      '**/node_modules/**',
      '**/target/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      // Harness workspace: private scratch (LOCAL-ONLY), never product source
      '.workspace/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
);
