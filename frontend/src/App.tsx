import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/primitives";
import { useAuth } from "@/store/useAuth";

import Dashboard from "@/pages/Dashboard";
import ManualControl from "@/pages/ManualControl";
import Designer from "@/pages/Designer";
import Login from "@/pages/Login";

// Ağır sayfalar ilk yüklemede indirilmesin
const Viewer3D = lazy(() => import("@/pages/Viewer3D"));
const Sensors = lazy(() => import("@/pages/Sensors"));
const CameraPage = lazy(() => import("@/pages/CameraPage"));
const Sequences = lazy(() => import("@/pages/Sequences"));
const ToolZone = lazy(() => import("@/pages/ToolZone"));
const Plants = lazy(() => import("@/pages/Plants"));
const Curves = lazy(() => import("@/pages/Curves"));
const Schedule = lazy(() => import("@/pages/Schedule"));
const Logs = lazy(() => import("@/pages/Logs"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

function PageFallback() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner className="size-7 text-brand" />
    </div>
  );
}

export default function App() {
  const status = useAuth((s) => s.status);
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

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
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
