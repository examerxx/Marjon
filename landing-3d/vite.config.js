import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = (p) => resolve(__dirname, p, 'index.html');
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: {
    assetsDir: 'static', // public/assets занят старыми privacy-страницами
    target: 'es2020',
    rollupOptions: {
      input: { ru: page('.'), uz: page('uz') },
      output: { manualChunks: { three: ['three'], gsap: ['gsap', 'lenis'] } },
    },
  },
});
