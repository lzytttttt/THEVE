import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        three: resolve(import.meta.dirname, 'src/three/index.ts'),
      },
      formats: ['es'],
      cssFileName: 'theve',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'three'],
    },
  },
});
