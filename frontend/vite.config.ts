import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Dev server proxies the Helm backend so the browser only ever talks to :5173.
// `VITE_BASE` is set in CI for the GitHub Pages deploy (served from /helm/).
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    // Allow Cloudflare quick-tunnel hostnames so the demo can be exposed publicly.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
