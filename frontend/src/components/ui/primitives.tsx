/**
 * Tasarım sisteminin yapı taşları.
 * Renkler doğrudan yazılmaz; index.css'teki token'lar üzerinden gelir.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

// --------------------------------------------------------------------------- //
// Kart / Panel
// --------------------------------------------------------------------------- //

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Kenarında marka rengiyle hafif bir ışıma bırakır — vurgulu kartlar için. */
  glow?: boolean;
  /** İçeriden dolgu vermez; tam kanama isteyen içerikler (canvas, tablo) için. */
  flush?: boolean;
}

export function Card({ className, glow, flush, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface ring-inset-light",
        "shadow-soft transition-soft",
        glow && "shadow-brand",
        !flush && "p-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {/*
            h2, h3 değil: kartlar sayfa başlığının (PageHeader'daki h1) hemen
            altında duruyor. h3 kullanmak h2'yi atlıyordu ve ekran okuyucuların
            başlıklar arasında gezinmesini bozuyordu.
          */}
          <h2 className="truncate text-base font-semibold text-content">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Buton
// --------------------------------------------------------------------------- //

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-brand text-white shadow-soft hover:brightness-110 active:brightness-95 " +
    "disabled:hover:brightness-100",
  secondary:
    "bg-surface-2 text-content border border-line hover:bg-surface-3 hover:border-line-strong",
  ghost: "text-muted hover:bg-surface-2 hover:text-content",
  danger: "bg-gradient-danger text-white shadow-soft hover:brightness-110",
  success: "bg-success/15 text-success border border-success/30 hover:bg-success/25",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  // Dokunmatik hedef: telefonda parmakla rahat basılsın
  xl: "h-16 px-8 text-lg gap-3 rounded-2xl",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, icon, fullWidth, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-soft",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "active:scale-[0.98]",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant = "ghost", size = "md", label, children, ...props },
  ref,
) {
  const sizes = { sm: "size-8 rounded-lg", md: "size-10 rounded-xl", lg: "size-12 rounded-xl" };
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid place-items-center transition-soft active:scale-95",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

// --------------------------------------------------------------------------- //
// Rozet
// --------------------------------------------------------------------------- //

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  brand: "bg-brand/12 text-brand border-brand/25",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  danger: "bg-danger/12 text-danger border-danger/25",
  info: "bg-info/12 text-info border-info/25",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  dot,
  pulse,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn("relative size-1.5 rounded-full bg-current", pulse && "pulse-dot")} />
      )}
      {children}
    </span>
  );
}

// --------------------------------------------------------------------------- //
// Form öğeleri
// --------------------------------------------------------------------------- //

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, suffix, id, ...props },
  ref,
) {
  const inputId = id ?? props.name;
  return (
    <label className="block" htmlFor={inputId}>
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-content">{label}</span>
      )}
      <span className="relative block">
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-11 w-full rounded-xl border bg-surface-2 px-3.5 text-sm text-content",
            "placeholder:text-subtle transition-soft",
            "focus:border-brand focus:bg-surface focus:outline-none",
            error ? "border-danger" : "border-line",
            suffix && "pr-12",
            className,
          )}
          {...props}
        />
        {suffix && (
          <span className="absolute inset-y-0 right-3 grid place-items-center text-sm text-subtle">
            {suffix}
          </span>
        )}
      </span>
      {(error || hint) && (
        <span className={cn("mt-1.5 block text-xs", error ? "text-danger" : "text-subtle")}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, children, id, ...props },
  ref,
) {
  const selectId = id ?? props.name;

  const field = (
    <select
      ref={ref}
      id={selectId}
      className={cn(
        "h-11 w-full appearance-none rounded-xl border border-line bg-surface-2 px-3.5",
        "text-sm text-content transition-soft focus:border-brand focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );

  /*
   * Görünür etiket yokken <label> ile sarmıyoruz.
   *
   * Eskiden her durumda sarılıyordu; `label` verilmediğinde geriye içi boş bir
   * <label> kalıyordu. Boş etiket erişilebilir ad üretmiyor, ekran okuyucu
   * alanı yalnızca "açılır liste" diye okuyor. Lighthouse bunu sensör
   * sayfasında raporladı.
   *
   * Etiketsiz kullanımda adı çağıran taraf `aria-label` ile vermeli.
   */
  if (!label) {
    return <div className="block">{field}</div>;
  }

  return (
    <label className="block" htmlFor={selectId}>
      <span className="mb-1.5 block text-sm font-medium text-content">{label}</span>
      {field}
    </label>
  );
});

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  tone = "brand",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  tone?: "brand" | "warning";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-soft",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? tone === "brand"
            ? "bg-gradient-brand"
            : "bg-gradient-warm"
          : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-white shadow-sm transition-all duration-200",
          checked ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  unit,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
  className?: string;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("w-full", className)}>
      {label && (
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-medium text-content">{label}</span>
          <span className="font-mono text-sm text-brand">
            {value}
            {unit}
          </span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none
                   [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                   [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform
                   [&::-webkit-slider-thumb]:hover:scale-110
                   [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
        style={{
          // Dolu kısım marka degradesi, kalanı yüzey rengi
          background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${percent}%, var(--surface-3) ${percent}%, var(--surface-3) 100%)`,
        }}
      />
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Durum göstergeleri
// --------------------------------------------------------------------------- //

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Yükleniyor"
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-subtle">
          {icon}
        </span>
      )}
      <div>
        {/* Boş durum kartın içinde duruyor; kart başlığı h2 olduğuna göre burası h3. */}
        <h3 className="text-base font-semibold text-content">{title}</h3>
        {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Sayısal özet kutusu — Kontrol Merkezi'ndeki metrik kartları. */
export function StatTile({
  label,
  value,
  unit,
  icon,
  tone = "brand",
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon?: ReactNode;
  tone?: BadgeTone;
  hint?: string;
}) {
  const accents: Record<BadgeTone, string> = {
    neutral: "text-muted",
    brand: "text-brand",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
  };

  return (
    <Card className="relative overflow-hidden">
      {/* Köşedeki yumuşak ışıma — düz renk yerine derinlik */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-[0.12] blur-2xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        {icon && <span className={cn("shrink-0", accents[tone])}>{icon}</span>}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-display text-2xl font-semibold tabular-nums text-content">
          {value}
        </span>
        {unit && <span className="text-sm text-subtle">{unit}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </Card>
  );
}

/** Bölüm başlığı — her sayfanın tepesinde. */
export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && (
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
            {icon}
          </span>
        )}
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-content">
            {title}
          </h1>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
