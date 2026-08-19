import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/primitives";
import { useAuth } from "@/store/useAuth";

// Giriş yapılmamışken gösterilen tek sayfa; paketten ayrılması anlamsız.
import Login from "@/pages/Login";

// Oturum açıldıktan sonraki açılış sayfası: bilerek eager tutuluyor, aksi
// halde her açılışta panel yerine bir an spinner görünürdü. Kiosk ekranında
// bu geri adım olur.
import Dashboard from "@/pages/Dashboard";

// Ağır sayfalar ilk yüklemede indirilmesin
const ManualControl = lazy(() => import("@/pages/ManualControl"));
const Designer = lazy(() => import("@/pages/Designer"));
const Viewer3D = lazy(() => import("@/pages/Viewer3D"));
const Sensors = lazy(() => import("@/pages/Sensors"));
const CameraPage = lazy(() => import("@/pages/CameraPage"));
const Sequences = lazy(() => import("@/pages/Sequences"));
const ToolZone = lazy(() => import("@/pages/ToolZone"));
const Plants = lazy(() => import("@/pages/Plants"));
const Curves = lazy(() => import("@/pages/Curves"));
const Schedule = lazy(() => import("@/pages/Schedule"));
const Logs = lazy(() => import("@/pages/Logs"));
const Diagnostics = lazy(() => import("@/pages/Diagnostics"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const Setup = lazy(() => import("@/pages/Setup"));

function PageFallback() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner className="size-7 text-brand" />
    </div>
  );
}

/**
 * 3B görünümün paketini boşta kalan zamanda önden indirir.
 *
 * Viewer3D chunk'ı 244 KiB (gzip) ve %94'ü three.js — kesilecek yer yok.
 * Ama gerçek kullanım akışı giriş → panel → 3B görünüm olduğu için, kullanıcı
 * menüden tıklamadan önce paketi çekersek bekleme sıfırlanıyor. Slow 4G'de
 * ölçülen indirme süresi 1,2 saniyeydi.
 *
 * Üç durumda atlanıyor:
 *   - Giriş ekranındayken; orada indirilen her bayt ilk boyamayla yarışır ve
 *     o sayfanın skoru 99, bozmaya değmez.
 *   - Kullanıcı veri tasarrufu açtıysa.
 *   - Bağlantı 2G ise; böyle bir hatta 244 KiB'ı önden çekmek yardım değil
 *     köstek olur.
 */
function usePrefetchViewer(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (connection?.saveData) return;
    if (connection?.effectiveType && connection.effectiveType.endsWith("2g")) return;

    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // Aynı dinamik import lazy() tarafından da kullanılıyor; paketleyici
      // tekilleştirdiği için ikinci kez indirilmiyor, modül önbelleğe giriyor.
      //
      // Hata sessizce yutuluyor: bu yalnızca bir hızlandırma. İndirme
      // başarısız olursa kullanıcı 3B görünüme geçtiğinde lazy() zaten tekrar
      // deneyecek; buradan konsola hata basmanın kimseye faydası yok.
      void import("@/pages/Viewer3D").catch(() => {});
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }

    // Safari'de requestIdleCallback yok; sayfanın kendi işi bitsin diye bekliyoruz.
    const timer = window.setTimeout(warm, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);
}

export default function App() {
  const status = useAuth((s) => s.status);
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  usePrefetchViewer(status === "authenticated");

  if (status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-8 text-brand" />
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <Routes>
        <Route path="/giris" element={<Login />} />
        <Route path="*" element={<Navigate to="/giris" replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="viewer" element={<Viewer3D />} />
          <Route path="camera" element={<CameraPage />} />
          <Route path="sensors" element={<Sensors />} />
          <Route path="control" element={<ManualControl />} />
          <Route path="sequences" element={<Sequences />} />
          <Route path="tool-zone" element={<ToolZone />} />
          <Route path="designer" element={<Designer />} />
          <Route path="plants" element={<Plants />} />
          <Route path="curves" element={<Curves />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="logs" element={<Logs />} />
          <Route path="diagnostics" element={<Diagnostics />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="setup" element={<Setup />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
