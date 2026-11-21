import { defineConfig } from 'vitest/config';

export default defineConfig({
  // roomws ist per file: verlinkt und UMD; ohne Vorbündeln fehlt im Dev-Server der default-Export.
  optimizeDeps: { include: ['roomws'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
