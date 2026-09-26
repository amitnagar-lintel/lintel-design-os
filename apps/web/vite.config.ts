import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The pilot UI is served by Vite; /api is proxied to the Design OS API (LINTEL_API_URL, default the local API), so the
 * browser talks to one origin and the API needs no CORS for the pilot.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: { "/api": { target: env.LINTEL_API_URL ?? "http://127.0.0.1:3000", changeOrigin: false } },
    },
    preview: { port: Number(env.WEB_PORT ?? 5173), proxy: { "/api": { target: env.LINTEL_API_URL ?? "http://127.0.0.1:3000" } } },
  };
});
