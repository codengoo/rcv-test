import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: proxy /api → Nest (3333). Prod: build tĩnh ra dist, Nest serve cùng origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ["rcv-result.nghiacn.cloud"],
    proxy: {
      "/api": "http://localhost:3333",
    },
  },
  build: {
    outDir: "dist",
  },
});
