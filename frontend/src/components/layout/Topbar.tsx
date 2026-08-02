import { useLocation } from "react-router-dom";
import { LogOut, Menu, Moon, RefreshCw, Sun } from "lucide-react";
import { useState } from "react";

import { Badge, IconButton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { findNavItem } from "@/lib/navigation";
import { useAuth } from "@/store/useAuth";
import { useBot } from "@/store/useBot";
import { useTheme } from "@/store/useTheme";
import { EmergencyStop } from "@/components/control/EmergencyStop";
import { NotificationBell } from "./NotificationBell";

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname } = useLocation();
  const current = findNavItem(pathname);

  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const logout = useAuth((s) => s.logout);
  const user = useAuth((s) => s.user);

  const deviceId = useBot((s) => s.deviceId);
  const position = useBot((s) => s.status?.position);
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    if (!deviceId) return;
    setSyncing(true);
    try {
      await api.devices.requestSync(deviceId);
      toast.info("Durum isteği gönderildi");
    } catch (error) {
      toast.error("Senkronizasyon başarısız", (error as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 glass border-b border-line">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <IconButton label="Menüyü aç" onClick={onOpenMenu} className="lg:hidden">
          <Menu className="size-5" />
        </IconButton>

        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-semibold text-content sm:text-lg">
            {current?.label ?? "FarmBot"}
          </h2>
          <p className="hidden truncate text-xs text-muted sm:block">{current?.description}</p>
        </div>

        {/* Anlık konum — her ekranda görünür kalsın */}
        {position && (
          <Badge tone="brand" className="hidden font-mono md:inline-flex">
            X {Math.round(position.x)} · Y {Math.round(position.y)} · Z {Math.round(position.z)}
          </Badge>
        )}

        <div className="flex items-center gap-1">
          <NotificationBell />

          <IconButton label="Durumu yenile" onClick={handleSync} disabled={syncing || !deviceId}>
            <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
          </IconButton>

          <IconButton
            label={theme === "dark" ? "Aydınlık moda geç" : "Karanlık moda geç"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>

          <IconButton
            label={`Çıkış yap (${user?.email ?? ""})`}
            onClick={logout}
            className="hidden sm:inline-grid"
          >
            <LogOut className="size-4" />
          </IconButton>

          <EmergencyStop compact />
        </div>
      </div>
    </header>
  );
}
