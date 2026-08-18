import { useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  Home,
  Loader2,
} from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { useBot } from "@/store/useBot";

/** Tek dokunuşta alınacak adım seçenekleri (mm). */
const STEP_SIZES = [1, 10, 100, 500] as const;

interface JogPadProps {
  deviceId: string | null;
  speed: number;
}

/**
 * Yön tuşları. Dokunmatik hedefler telefonda rahat basılacak kadar büyük;
 * masaüstünde klavye ok tuşlarıyla da sürülebilir.
 */
export function JogPad({ deviceId, speed }: JogPadProps) {
  const [step, setStep] = useState<number>(100);
  const [pending, setPending] = useState<string | null>(null);
  const locked = useBot((s) => s.status?.locked ?? false);
  const position = useBot((s) => s.status?.position);
  const limits = useBot((s) => s.status?.informational?.axis_limits) as
    | Record<string, [number, number]>
    | undefined;

  /**
   * Bu adım eksen sınırının dışına çıkar mı?
   *
   * Robot sınırdayken düğmeye basmak eskiden sessizce başarısız oluyordu:
   * komut PLC'ye kadar gidiyor, orada reddediliyor ve kullanıcı hiçbir şey
   * görmüyordu. Artık düğme baştan kilitleniyor ve sebebini yazıyor.
   */
  function blockedReason(axis: "x" | "y" | "z", direction: 1 | -1): string | null {
    const range = limits?.[axis];
    if (!range || !position) return null;

    const [low, high] = range;
    const target = position[axis] + step * direction;
    if (target < low) {
      return `${axis.toUpperCase()} ekseni en fazla ${Math.round(low)} mm'ye kadar inebilir`;
    }
    if (target > high) {
      return `${axis.toUpperCase()} ekseni en fazla ${Math.round(high)} mm'ye kadar çıkabilir`;
    }
    return null;
  }

  async function jog(axis: "x" | "y" | "z", direction: 1 | -1, key: string) {
    if (!deviceId) return;
    setPending(key);
    try {
      await api.control.moveRelative(deviceId, { [axis]: step * direction, speed });
    } catch (error) {
      toast.error("Hareket başarısız", (error as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function goHome(axis: "all" | "z") {
    if (!deviceId) return;
    setPending(`home-${axis}`);
    try {
      await api.control.home(deviceId, { axis, speed });
      toast.info(axis === "all" ? "Robot eve dönüyor" : "Z ekseni yukarı çekiliyor");
    } catch (error) {
      toast.error("Komut gönderilemedi", (error as Error).message);
    } finally {
      setPending(null);
    }
  }

  const disabled = !deviceId || locked;

  /** Yön düğmesinin ortak özelliklerini üretir (sınır kontrolü dahil). */
  function axisButton(axis: "x" | "y" | "z", direction: 1 | -1, key: string, label: string) {
    const blocked = blockedReason(axis, direction);
    return {
      label: blocked ?? label,
      blocked: Boolean(blocked),
      disabled: disabled || Boolean(blocked),
      loading: pending === key,
      onClick: () => jog(axis, direction, key),
    };
  }

  return (
    <div className="space-y-5">
      {/* Adım büyüklüğü */}
      <div>
        <p className="mb-2 text-sm font-medium text-content">Adım Büyüklüğü</p>
        <div className="grid grid-cols-4 gap-2">
          {STEP_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setStep(size)}
              className={cn(
                "h-11 rounded-xl border text-sm font-semibold transition-soft active:scale-95",
                step === size
                  ? "border-transparent bg-gradient-brand text-white shadow-soft"
                  : "border-line bg-surface-2 text-muted hover:text-content",
              )}
            >
              {size >= 1000 ? `${size / 1000} m` : `${size} mm`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-center gap-6">
        {/* X / Y yön tuşları */}
        <div className="grid grid-cols-3 grid-rows-3 gap-2">
          <div />
          <JogButton
            {...axisButton("y", 1, "y+", "Y ekseninde ileri")}
          >
            <ArrowUp className="size-6" />
          </JogButton>
          <div />

          <JogButton
            {...axisButton("x", -1, "x-", "X ekseninde sola")}
          >
            <ArrowLeft className="size-6" />
          </JogButton>

          <JogButton
            label="Eve dön"
            disabled={disabled}
            loading={pending === "home-all"}
            onClick={() => goHome("all")}
            variant="home"
          >
            <Home className="size-5" />
          </JogButton>

          <JogButton
            {...axisButton("x", 1, "x+", "X ekseninde sağa")}
          >
            <ArrowRight className="size-6" />
          </JogButton>

          <div />
          <JogButton
            {...axisButton("y", -1, "y-", "Y ekseninde geri")}
          >
            <ArrowDown className="size-6" />
          </JogButton>
          <div />
        </div>

        {/* Z ekseni */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Z</span>
          <JogButton
            {...axisButton("z", 1, "z+", "Z ekseninde yukarı")}
          >
            <ArrowUpToLine className="size-6" />
          </JogButton>
          <JogButton
            label="Z eksenini yukarı çek"
            disabled={disabled}
            loading={pending === "home-z"}
            onClick={() => goHome("z")}
            variant="home"
          >
            <Home className="size-5" />
          </JogButton>
          <JogButton
            {...axisButton("z", -1, "z-", "Z ekseninde aşağı")}
          >
            <ArrowDownToLine className="size-6" />
          </JogButton>
        </div>
      </div>

      {!locked && limits && position && (
        <p className="text-center text-xs text-subtle">
          Eksen sınırları:{" "}
          {(["x", "y", "z"] as const)
            .filter((axis) => limits[axis])
            .map((axis) => `${axis.toUpperCase()} ${Math.round(limits[axis][0])}–${Math.round(limits[axis][1])}`)
            .join(" · ") || "tanımsız"}{" "}
          mm · <span className="text-danger">kırmızı düğme</span> sınıra ulaşıldığını gösterir
        </p>
      )}

      {locked && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          Robot acil durdurma kilidinde. Hareket komutları için önce kilidi açın.
        </p>
      )}
    </div>
  );
}

function JogButton({
  children,
  label,
  onClick,
  disabled,
  loading,
  blocked,
  variant = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Eksen sınırı yüzünden engellendi — kırmızı göster, sebebi başlıkta yaz */
  blocked?: boolean;
  variant?: "default" | "home";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      title={label}
      className={cn(
        // Dokunmatikte rahat basılabilecek boyut
        "grid size-[4.5rem] place-items-center rounded-2xl transition-soft",
        "active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
        blocked
          ? "border border-danger/40 bg-danger/10 text-danger opacity-100"
          : variant === "home"
            ? "border border-line bg-surface-2 text-muted hover:text-brand"
            : "bg-gradient-surface border border-line text-content shadow-soft hover:border-brand/40 hover:text-brand",
      )}
    >
      {loading ? <Loader2 className="size-5 animate-spin text-brand" /> : children}
    </button>
  );
}
