import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Отдельный конфиг: сбор DOM не должен запускаться вместе с продуктовыми тестами.
export default defineConfig({
  plugins: [react()],
  root: process.cwd(),
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    include: ["tools/audit/harvest-*.jsx"],
    testTimeout: 120000,
  },
});
