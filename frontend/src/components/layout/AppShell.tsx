import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useBot } from "@/store/useBot";
import { Spinner } from "@/components/ui/primitives";
import { ErrorBoundary } from "./ErrorBoundary";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Giriş yapmış kullanıcının gördüğü ana yerleşim.
 * Aktif cihazı seçer ve canlı durum bağlantısını kurar.
 */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  const attach = useBot((s) => s.attach);
  const detach = useBot((s) => s.detach);

  const { data: devices, isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: api.devices.list,
  });

  // Şimdilik ilk cihaz aktif kabul edilir; çoklu robot seçimi Ayarlar'dan gelecek
  const activeDevice = devices?.[0];

  useEffect(() => {
    if (activeDevice) attach(activeDevice.id);
    return () => detach();
  }, [activeDevice, attach, detach]);

  // Sayfa değişince mobil çekmeceyi kapat
  useEffect(() => setMenuOpen(false), [pathname]);

  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner className="size-8 text-brand" />
          <p className="text-sm">Robot bilgileri yükleniyor…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="lg:pl-72">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />

        {/* Alt boşluk: mobil alt menünün içeriği örtmemesi için */}
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 pb-28 sm:px-6 lg:pb-10">
          {/* Bir bölüm çökerse sadece o alan hata gösterir, kabuk ayakta kalır */}
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
