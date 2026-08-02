import { Lock, Radio, WifiOff } from "lucide-react";

import { useBot } from "@/store/useBot";
import { cn } from "@/lib/cn";

/** Robotun bağlantı ve kilit durumunu tek bakışta özetler. */
export function ConnectionPill() {
  const connected = useBot((s) => s.connected);
  const status = useBot((s) => s.status);

  const locked = status?.locked ?? false;
  const online = connected && (status?.online ?? false);

  const state = locked
    ? {
        label: "Acil Kilit",
        detail: "Hareket durduruldu",
        Icon: Lock,
        classes: "border-danger/30 bg-danger/10 text-danger",
      }
    : online
      ? {
          label: "Çevrimiçi",
          detail: status?.busy ? "Komut çalışıyor" : "Hazır",
          Icon: Radio,
          classes: "border-success/30 bg-success/10 text-success",
        }
      : {
          label: "Çevrimdışı",
          detail: connected ? "Robot yanıt vermiyor" : "Sunucuya bağlanılıyor",
          Icon: WifiOff,
          classes: "border-line bg-surface-2 text-muted",
        };

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-soft",
        state.classes,
      )}
    >
      <span className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-current/15">
        <state.Icon className="size-3.5" />
        {online && !locked && (
          <span className="pulse-dot absolute inset-0 rounded-lg opacity-40" />
        )}
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-semibold">{state.label}</p>
        <p className="truncate text-[0.7rem] opacity-80">{state.detail}</p>
      </div>
    </div>
  );
}
