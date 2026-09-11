import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    // Coverage (M5-004): v8 provider, raw JSON for the ratchet + text for humans.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: '.workspace/coverage',
      include: ['packages/**/src/**', 'apps/cli/src/**', 'apps/core-service/src/**'],
      exclude: ['**/schemas/**', '**/generated*.ts', '**/resources.generated.ts', '**/vendor/**', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      // Workspace packages are not linked into the root node_modules by pnpm;
      // point tests at the TypeScript sources so they work before `pnpm run build`.
      '@lmps/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@lmps/i18n': fileURLToPath(new URL('./packages/i18n/src/index.ts', import.meta.url)),
      '@lmps/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
      '@lmps/hardware': fileURLToPath(new URL('./packages/hardware/src/index.ts', import.meta.url)),
      '@lmps/benchmark': fileURLToPath(new URL('./packages/benchmark/src/index.ts', import.meta.url)),
      '@lmps/lmstudio-adapter': fileURLToPath(
        new URL('./packages/lmstudio-adapter/src/index.ts', import.meta.url),
      ),
      '@lmps/optimizer': fileURLToPath(new URL('./packages/optimizer/src/index.ts', import.meta.url)),
      '@lmps/profile-store': fileURLToPath(
        new URL('./packages/profile-store/src/index.ts', import.meta.url),
      ),
    },
  },
});