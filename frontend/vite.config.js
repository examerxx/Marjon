import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        kafe: "index.html",
        admin: "admin.html",
      },
    },
  },
});
