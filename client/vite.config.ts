/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // dev only: forward the WebSocket to the local server process
      "/ws": {
        target: "ws://localhost:8585",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // main.tsx is the DOM bootstrap; types.ts has no runtime code;
      // the rest is test scaffolding
      exclude: [
        "src/main.tsx",
        "src/types.ts",
        "src/vite-env.d.ts",
        "src/test-setup.ts",
        "src/test-utils.tsx",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
