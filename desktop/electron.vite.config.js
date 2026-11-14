import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'node:fs'
import { resolve } from 'path'

// main-bundle оставляет require('./offline') как есть, поэтому движок должен
// лежать рядом с out/main/index.js и в dev, и в собранном приложении
// (electron-builder пакует только out/**). Без этого Electron падал на старте:
// "Cannot find module './offline'".
const copyOfflineEngine = {
  name: 'copy-offline-engine',
  closeBundle() {
    cpSync(resolve(__dirname, 'electron/offline'), resolve(__dirname, 'out/main/offline'), { recursive: true })
  },
}

export default defineConfig({
  main: {
    plugins: [copyOfflineEngine],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.js') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.js') }
      }
    }
  },
  renderer: {
    root: 'src',
    // Явный порт dev-сервера рендерера. Веб-фронт (frontend/) уже держит
    // дефолтный Vite-порт 5173; без этой строки electron-vite поднимал бы
    // рендерер тоже на 5173, и в режиме «фронт + десктоп» два Vite-сервера
    // дрались за порт (второй молча уезжал на 5174 — недетерминированно).
    // strictPort фиксирует 5174 и падает явно при реальном конфликте.
    server: {
      port: 5174,
      strictPort: true,
      // ── Dev-прокси на удалённый бэкенд ──────────────────────────────────────
      // api.marjon.tech в CORS-whitelist держит только https://marjon.tech,
      // поэтому прямые запросы из рендерера (origin http://localhost:5174)
      // получают "Disallowed CORS origin". Прокси переносит запрос на сервер
      // same-origin, и браузерный CORS в этом сценарии не участвует.
      // Только для `npm run dev` — на production-сборку не влияет.
      // Адрес сервера в приложении: http://localhost:5174/api/v1
      proxy: {
        '/api': {
          target: 'https://api.marjon.tech',
          changeOrigin: true,
          secure: true,
          ws: true,
          headers: { Origin: 'https://marjon.tech' },
        },
        '/ws': {
          target: 'wss://api.marjon.tech',
          changeOrigin: true,
          secure: true,
          ws: true,
          headers: { Origin: 'https://marjon.tech' },
        },
        '/health': {
          target: 'https://api.marjon.tech',
          changeOrigin: true,
          secure: true,
          headers: { Origin: 'https://marjon.tech' },
        },
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html')
      }
    }
  }
})
