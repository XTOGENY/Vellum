import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 8781,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8780",
      "/media": "http://127.0.0.1:8780",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/@codemirror/") ||
            id.includes("/node_modules/@lezer/")
          )
            return "prompt-editor";
        },
      },
    },
  },
});
