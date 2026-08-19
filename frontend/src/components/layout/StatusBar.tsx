/**
 * Kalıcı durum şeridi — her sayfanın üstünde.
 *
 * Neden var: "robot şu an ne yapıyor?" sorusunun cevabı üç ayrı yere dağılmıştı.
 * Bağlantı yan menüdeki rozette, konum yalnızca 3B ve manuel kontrol
 * sayfalarında, kilit durumu ise bir başka kartta görünüyordu. Tarla
 * tasarımcısındayken robotun kilitli olduğunu fark etmenin hiçbir yolu yoktu.
 *
 * Şerit tek satırda dört soruyu yanıtlıyor: bağlı mı, kilitli mi, nerede,
 * ne yapıyor. Dar ekranda alt alta sarıyor; kritik olan (durum ve konum)
 * her zaman ilk sırada kalıyor.
 */

import { AlertTriangle, Lock, Loader2, MapPin, Radio, Wifi, WifiOff, Wrench } from "lucide-react";

import { cn } from "@/lib/cn";
import { useBot } from "@/store/useBot";

export function StatusBar() {
  const connected = useBot((s) => s.connected);
  const status = useBot((s) => s.status);

  const locked = status?.locked ?? false;
  const online = connected && (status?.online ?? false);
  const busy = status?.busy ?? false;
  const position = status?.position;
  const axisStates = status?.axis_states ?? {};
  const tool = status?.informational?.current_tool as string | undefined;

  // Kilit her şeyin önünde: hareket etmeyen bir robotta "çevrimiçi" yazmak
  // yanıltıcı olur.
  const state = locked
    ? {
        label: "Acil kilit",
        detail: "Hareket komutları reddediliyor",
        Icon: Lock,
        tone: "border-danger/30 bg-danger/10 text-danger",
      }
    : !connected
      ? {
          label: "Sunucuya bağlanılıyor",
          detail: "Panel ile bulut arasında bağlantı yok",
          Icon: WifiOff,
          tone: "border-line bg-surface-2 text-muted",
        }
      : !online
        ? {
            label: "Robot çevrimdışı",
            detail: "Köprü ajanı veri göndermiyor",
            Icon: AlertTriangle,
            tone: "border-warning/30 bg-warning/10 text-warning",
          }
        : busy
          ? {
              label: "Çalışıyor",
              detail: "Komut yürütülüyor",
              Icon: Loader2,
              tone: "border-brand/30 bg-brand/10 text-brand",
            }
          : {
              label: "Hazır",
              detail: "Komut bekliyor",
              Icon: Radio,
              tone: "border-success/30 bg-success/10 text-success",
            };

  const movingAxes = (["x", "y", "z"] as const).filter(
    (axis) => axisStates[axis] === "moving",
  );
  const erroredAxes = (["x", "y", "z"] as const).filter(
    (axis) => axisStates[axis] === "error",
  );

  return (
    <div className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        {/* Durum */}
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium",
            state.tone,
          )}
          title={state.detail}
        >
          <state.Icon className={cn("size-3.5", busy && !locked && "animate-spin")} />
          {state.label}
        </span>

        {/* Konum */}
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
          <MapPin className="size-3.5 text-subtle" />
          {position
            ? `X ${position.x.toFixed(1)} · Y ${position.y.toFixed(1)} · Z ${position.z.toFixed(1)} mm`
            : "konum bilinmiyor"}
        </span>

        {/* Hareket eden ya da hatalı eksenler — yalnızca söyleyecek bir şey varken */}
        {movingAxes.length > 0 && (
          <span className="text-xs text-brand">
            {movingAxes.map((a) => a.toUpperCase()).join(" · ")} hareket ediyor
          </span>
        )}
        {erroredAxes.length > 0 && (
          <span className="text-xs text-danger">
            {erroredAxes.map((a) => a.toUpperCase()).join(" · ")} ekseninde hata
          </span>
        )}

        {/* Takılı uç */}
        {tool && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <Wrench className="size-3.5 text-subtle" />
            {tool}
          </span>
        )}

        {/* Bağlantı göstergesi en sağda */}
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-subtle"
          title={connected ? "Panel buluta bağlı" : "Panel bulut ile bağlantısını kaybetti"}
        >
          <Wifi className={cn("size-3.5", connected ? "text-success" : "text-subtle")} />
          {connected ? "canlı" : "bağlantı yok"}
        </span>
      </div>
    </div>
  );
}
