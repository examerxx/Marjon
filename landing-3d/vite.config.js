import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = (p) => resolve(__dirname, p, 'index.html');
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: {
    outDir: process.env.PROD === '1' ? 'dist-prod' : 'dist',
    assetsDir: 'static', // public/assets занят старыми privacy-страницами
    target: 'es2020',
    rollupOptions: {
      input: process.env.PROD === '1' ? { index: page('.'), uz: page('uz') } : { index: page('.'), uz: page('uz'), e: page('e'), e_uz: page('e/uz'), f: page('f'), f_uz: page('f/uz'), g: page('g'), g_uz: page('g/uz'), h: page('h'), h_uz: page('h/uz'), ah: page('ah'), ah_uz: page('ah/uz') },
      output: { manualChunks: { three: ['three'], gsap: ['gsap', 'lenis'] } },
    },
  },
});
