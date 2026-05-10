import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'path';

/**
 * Multi-entry build for both webviews. The shared React + UI vendor code
 * lands in a single deterministic chunk (vendor.js) so the host only has to
 * reference 3 stable filenames per panel: <entry>.js, vendor.js, styles.css.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src/webview') },
  },
  build: {
    outDir: 'out/webviews',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, 'src/webview/sidebar/main.tsx'),
        workspace: resolve(__dirname, 'src/webview/workspace/main.tsx'),
        tokenReport: resolve(__dirname, 'src/webview/report/main.tsx'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith('.css')) { return 'styles.css'; }
          return 'assets/[name][extname]';
        },
        manualChunks(id) {
          if (id.includes('node_modules')) { return 'vendor'; }
          // Force our shared lib + hooks into a deterministically-named
          // chunk so the host can reference it by stable filename.
          if (id.includes('/src/webview/lib/') || id.includes('/src/webview/hooks/')) {
            return 'common';
          }
          return undefined;
        },
      },
    },
  },
});
