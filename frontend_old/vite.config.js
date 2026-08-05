import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Docker (Windows-хост) bind-mount: события файловой системы (inotify) из
    // Windows часто не долетают до chokidar внутри Linux-контейнера, поэтому
    // Vite не замечает изменения файлов и отдаёт из памяти старую версию,
    // даже если сам файл на диске уже обновлён. Polling обходит это, опрашивая
    // mtime вручную вместо ожидания fs-событий.
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        kafe: "index.html",
        admin: "admin.html",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.test.{js,jsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
});
