import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const isCapacitorTarget = process.env.VITE_TARGET === 'capacitor';
const capacitorStubPath = fileURLToPath(new URL('./src/lib/capacitor-stub.js', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: isCapacitorTarget
      ? {}
      : {
          '@capacitor/app': capacitorStubPath,
          '@capacitor/geolocation': capacitorStubPath
        }
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      },
      '/health': 'http://localhost:3000'
    }
  }
});
