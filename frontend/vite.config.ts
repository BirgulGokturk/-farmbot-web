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
    /*
     * Kaynak haritaları açık.
     *
     * Kapalıyken üretimde performans kaydı almak işe yaramıyordu: profildeki
     * fonksiyon adları `C`, `Cl`, `xh` gibi geliyor ve hangi three.js sınıfının
     * pahalı olduğu anlaşılmıyor. Lighthouse de "Large JavaScript file is
     * missing a source map" uyarısı veriyordu.
     *
     * Maliyeti yok: `.map` dosyaları yalnızca geliştirici araçları açıkken
     * indiriliyor, normal ziyaretçi hiç istemiyor. Gizlilik açısından da bir
     * kaybı yok — depo zaten herkese açık.
     */
    sourcemap: true,
    // Parçalama elle yapılmıyor: three ve recharts zaten yalnızca lazy
    // sayfalardan (Viewer3D, Sensors) çağrıldığı için paketleyici bunları
    // kendiliğinden ayrı chunk'a alıyor.
    //
    // Elle yazılan manualChunks kuralı geri tepmişti: `id.includes("three")`
    // gibi substring eşleşmeleri React ve react-dom'u da o chunk'ların içine
    // mühürlüyor, entry React'i oradan almak için chunk'ları statik import
    // etmek zorunda kalıyordu. Sonuç: giriş ekranı için 1,45 MB JS.
  },
});
