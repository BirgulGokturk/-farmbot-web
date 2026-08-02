import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    host: true, // Docker içinden ve yerel ağdaki telefondan erişilebilsin
    proxy: {
      // Geliştirmede CORS ile uğraşmamak için API'yi aynı origin'den servis et
      "/api": {
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
        ws: true, // WebSocket bağlantısı da vekilden geçsin
      },
      "/media": {
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Ağır kütüphaneleri ayrı parçalara böl — ilk yükleme hafiflesin
        manualChunks(id) {
          if (id.includes("three") || id.includes("@react-three")) return "three";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          return undefined;
        },
      },
    },
  },
});
