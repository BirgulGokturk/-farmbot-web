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
            label="Y ekseninde ileri"
            disabled={disabled}
            loading={pending === "y+"}
            onClick={() => jog("y", 1, "y+")}
          >
            <ArrowUp className="size-6" />
          </JogButton>
          <div />

          <JogButton
            label="X ekseninde sola"
            disabled={disabled}
            loading={pending === "x-"}
            onClick={() => jog("x", -1, "x-")}
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
            label="X ekseninde sağa"
            disabled={disabled}
            loading={pending === "x+"}
            onClick={() => jog("x", 1, "x+")}
          >
            <ArrowRight className="size-6" />
          </JogButton>

          <div />
          <JogButton
            label="Y ekseninde geri"
            disabled={disabled}
            loading={pending === "y-"}
            onClick={() => jog("y", -1, "y-")}
          >
            <ArrowDown className="size-6" />
          </JogButton>
          <div />
        </div>

        {/* Z ekseni */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Z</span>
          <JogButton
            label="Z ekseninde yukarı"
            disabled={disabled}
            loading={pending === "z+"}
            onClick={() => jog("z", 1, "z+")}
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
            label="Z ekseninde aşağı"
            disabled={disabled}
            loading={pending === "z-"}
            onClick={() => jog("z", -1, "z-")}
          >
            <ArrowDownToLine className="size-6" />
          </JogButton>
        </div>
      </div>

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
  variant = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
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
        variant === "home"
          ? "border border-line bg-surface-2 text-muted hover:text-brand"
          : "bg-gradient-surface border border-line text-content shadow-soft hover:border-brand/40 hover:text-brand",
      )}
    >
      {loading ? <Loader2 className="size-5 animate-spin text-brand" /> : children}
    </button>
  );
}
