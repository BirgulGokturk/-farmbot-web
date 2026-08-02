import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, OctagonX, Unlock } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { useBot } from "@/store/useBot";

/**
 * Acil durdurma / kilit açma.
 *
 * Durdurma tek dokunuşla çalışır (acil durumda onay penceresi zaman kaybettirir);
 * kilidi AÇMAK ise onay ister — robot beklenmedik anda hareket etmesin.
 */
export function EmergencyStop({ compact = false }: { compact?: boolean }) {
  const deviceId = useBot((s) => s.deviceId);
  const locked = useBot((s) => s.status?.locked ?? false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  async function run(action: "lock" | "unlock") {
    if (!deviceId) return;
    setBusy(true);
    try {
      if (action === "lock") {
        await api.control.emergencyLock(deviceId);
        toast.warning("Acil durdurma etkin", "Robotun tüm hareketi kesildi.");
      } else {
        await api.control.emergencyUnlock(deviceId);
        toast.success("Kilit açıldı", "Robot yeniden komut alabilir.");
      }
      await queryClient.invalidateQueries({ queryKey: ["device", deviceId] });
    } catch (error) {
      toast.error("İşlem başarısız", (error as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (compact) {
    return (
      <button
        onClick={() => (locked ? setConfirming(true) : run("lock"))}
        disabled={busy || !deviceId}
        aria-label={locked ? "Kilidi aç" : "Acil durdurma"}
        title={locked ? "Kilidi aç" : "Acil durdurma"}
        className={cn(
          "ml-1 inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold",
          "transition-soft active:scale-95 disabled:opacity-50",
          locked
            ? "border border-warning/40 bg-warning/15 text-warning hover:bg-warning/25"
            : "bg-gradient-danger text-white shadow-soft hover:brightness-110",
        )}
      >
        {locked ? <Unlock className="size-4" /> : <OctagonX className="size-4" />}
        <span className="hidden sm:inline">{locked ? "Kilidi Aç" : "DURDUR"}</span>
        {confirming && (
          <ConfirmUnlock onCancel={() => setConfirming(false)} onConfirm={() => run("unlock")} />
        )}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => (locked ? setConfirming(true) : run("lock"))}
        disabled={busy || !deviceId}
        className={cn(
          "group relative grid w-full place-items-center gap-2 rounded-2xl p-6",
          "transition-soft active:scale-[0.98] disabled:opacity-50",
          locked
            ? "border-2 border-warning/40 bg-warning/10"
            : "bg-gradient-danger shadow-[0_0_0_1px_rgb(225_29_72/0.3),0_12px_40px_-8px_rgb(225_29_72/0.5)]",
        )}
      >
        <span
          className={cn(
            "grid size-14 place-items-center rounded-full",
            locked ? "bg-warning/20 text-warning" : "bg-white/20 text-white",
          )}
        >
          {locked ? <Unlock className="size-7" /> : <LockKeyhole className="size-7" />}
        </span>
        <span
          className={cn(
            "font-display text-lg font-bold tracking-wide",
            locked ? "text-warning" : "text-white",
          )}
        >
          {locked ? "KİLİDİ AÇ" : "ACİL DURDURMA"}
        </span>
        <span className={cn("text-xs", locked ? "text-warning/80" : "text-white/80")}>
          {locked ? "Robot şu anda kilitli" : "Tüm hareketi anında keser"}
        </span>
      </button>

      {confirming && (
        <ConfirmUnlock onCancel={() => setConfirming(false)} onConfirm={() => run("unlock")} />
      )}
    </div>
  );
}

function ConfirmUnlock({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-left shadow-float"
      >
        <h3 className="font-display text-lg font-semibold text-content">Kilidi açmak istiyor musunuz?</h3>
        <p className="mt-2 text-sm text-muted">
          Kilit açıldığında robot bekleyen komutları uygulamaya başlayabilir. Çalışma alanında
          kimsenin ve hiçbir engelin olmadığından emin olun.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="h-10 flex-1 rounded-xl border border-line bg-surface-2 text-sm font-medium text-content transition-soft hover:bg-surface-3"
          >
            Vazgeç
          </button>
          <button
            onClick={onConfirm}
            className="h-10 flex-1 rounded-xl bg-gradient-warm text-sm font-semibold text-white transition-soft hover:brightness-110"
          >
            Evet, kilidi aç
          </button>
        </div>
      </div>
    </div>
  );
}
