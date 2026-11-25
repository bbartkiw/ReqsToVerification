import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  root: resolve(here, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
  },
  test: {
    root: here,
    include: ['tests/**/*.test.ts'],
  },
});
