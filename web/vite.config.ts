import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api → Nest (3000). Prod: build tĩnh ra dist, Nest serve cùng origin.
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["rcv-result.nghiacn.cloud"],
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
