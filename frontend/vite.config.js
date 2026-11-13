import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: ".vite-cache-5293",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // Фото блюд без MinIO (dev): backend отдаёт их с /media.
      "/media": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // Marjon store (/store): установщики десктопа живут только на сервере
      // (nginx отдаёт их из /usr/share/nginx/store). В dev проксируем туда,
      // иначе таблица и кнопки «Скачать» локально отдают 404.
      "/store/files": {
        target: "https://adminka.marjon.tech",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        kafe: "index.html",
        admin: "admin.html",
        kitchen: "kitchen.html",
      },
      output: {
        // Split heavy, rarely-changing third-party code into cacheable vendor
        // chunks so the app entries stay small and a redeploy doesn't bust the
        // whole bundle. Build-output only — does not affect runtime behavior,
        // tests, or the CSS visual oracle (both render via vitest/jsdom).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/xlsx")) return "vendor-xlsx";
          if (id.includes("/chart.js") || id.includes("/@kurkle")) return "vendor-charts";
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (id.includes("/i18next") || id.includes("/react-i18next")) return "vendor-i18n";
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.test.{js,jsx}"],
    clearMocks: true,
    restoreMocks: true,
    // Продуктовые drawer-тесты сотрудников рендерят матрицу из 50 модулей
    // (≈250 кнопок с role/aria), и один запрос по role в таком дереве стоит
    // секунды в jsdom. Дефолтные 5с не хватает даже на одиночный прогон,
    // поэтому даём общий бюджет и ограничиваем число воркеров, чтобы файлы
    // не отбирали CPU друг у друга.
    testTimeout: 45000,
    hookTimeout: 45000,
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
  },
});
