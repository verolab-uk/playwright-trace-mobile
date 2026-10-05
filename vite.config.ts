import fs from 'fs';
import path from 'path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { bundle } from './packages/trace-viewer/bundle';

// Mirrors packages/trace-viewer/vite.config.ts from upstream, but builds into
// dist/ instead of playwright-core/lib, so that file can stay untouched.
const viewer = path.resolve(__dirname, 'packages/trace-viewer');
const outDir = path.resolve(__dirname, 'dist');
const upstreamVersion = fs.readFileSync(path.resolve(__dirname, 'UPSTREAM'), 'utf8').split(' ')[0].replace(/^v/, '');

export default defineConfig({
  root: viewer,
  base: '',
  publicDir: path.join(viewer, 'public'),
  plugins: [
    react(),
    bundle()
  ],
  define: {
    'process.env': {},
    '__APP_VERSION__': JSON.stringify(upstreamVersion),
  },
  resolve: {
    alias: {
      '@injected': path.resolve(__dirname, 'packages/injected/src'),
      '@isomorphic': path.resolve(__dirname, 'packages/isomorphic'),
      '@testIsomorphic': path.resolve(__dirname, 'packages/playwright/src/isomorphic'),
      '@web': path.resolve(__dirname, 'packages/web/src'),
    },
  },
  builder: {},
  environments: {
    client: {
      build: {
        outDir,
        emptyOutDir: false,
        rollupOptions: {
          input: {
            index: path.join(viewer, 'index.html'),
            uiMode: path.join(viewer, 'uiMode.html'),
            snapshot: path.join(viewer, 'snapshot.html'),
          },
          output: {
            entryFileNames: () => '[name].[hash].js',
            assetFileNames: () => '[name].[hash][extname]',
            manualChunks: undefined,
          },
        },
      },
    },
    sw: {
      consumer: 'client',
      build: {
        outDir,
        emptyOutDir: false,
        rollupOptions: {
          input: {
            sw: path.join(viewer, 'src/sw-main.ts'),
          },
          output: {
            entryFileNames: () => 'sw.bundle.js',
            assetFileNames: () => 'sw.[hash][extname]',
            manualChunks: undefined,
          },
        },
      },
    },
  },
});
