import { defineConfig } from 'vitest/config';

export default defineConfig({
  // roomws ist per file: verlinkt und UMD; ohne Vorbündeln fehlt im Dev-Server der default-Export.
  optimizeDeps: { include: ['roomws'] },
  // Die Tray-Symbole liegen bei der Desktop-App und werden in den Desktop-Chunk eingebettet.
  server: { fs: { allow: ['.', '../desktop/src-tauri/icons'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
