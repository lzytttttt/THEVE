import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const libSrc = resolve(import.meta.dirname, '../../packages/theve-ui/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@theve\/ui\/styles\.css$/, replacement: resolve(libSrc, 'styles/index.css') },
      { find: /^@theve\/ui\/three$/, replacement: resolve(libSrc, 'three/index.ts') },
      { find: /^@theve\/ui$/, replacement: resolve(libSrc, 'index.ts') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
