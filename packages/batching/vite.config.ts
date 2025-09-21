/// <reference types="vitest" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        resolvers: resolve(__dirname, 'src/resolvers.ts'),
        schedulers: resolve(__dirname, 'src/schedulers.ts'),
      },
      formats: ['es', 'cjs'],
      name: '@easy-sync/batching',
    },
  },
  plugins: [dts({ rollupTypes: true })],
  test: {},
});
