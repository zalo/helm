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
    host: true,
    port: 5173,
    // `.trycloudflare.com` for Cloudflare quick-tunnels; `.ts.net` for Tailscale MagicDNS.
    allowedHosts: [".trycloudflare.com", ".ts.net"],
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
