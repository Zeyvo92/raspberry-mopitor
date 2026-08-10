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
});
