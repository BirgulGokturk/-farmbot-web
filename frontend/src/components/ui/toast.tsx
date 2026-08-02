/** Hafif bildirim sistemi — komut sonuçlarını ve hataları gösterir. */

import { useEffect } from "react";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** ms; 0 verilirse elle kapatılana kadar kalır */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => number;
  dismiss: (id: number) => void;
}

let nextId = 0;

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push({ duration = 4000, ...rest }) {
    const id = ++nextId;
    set((state) => ({ toasts: [...state.toasts, { id, duration, ...rest }] }));
    return id;
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Bileşen dışından da çağrılabilsin diye doğrudan store'a erişir. */
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "error", title, description, duration: 6000 }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "info", title, description }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: "warning", title, description }),
};

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
} as const;

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success/30 text-success",
  error: "border-danger/30 text-danger",
  info: "border-info/30 text-info",
  warning: "border-warning/30 text-warning",
};

function ToastCard({ item }: { item: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const Icon = ICONS[item.tone];

  useEffect(() => {
    if (item.duration <= 0) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, dismiss]);

  return (
    <div
      role="status"
      className={cn(
        "animate-fade-up pointer-events-auto flex w-full items-start gap-3 rounded-xl border",
        "glass p-3.5 shadow-float",
        TONE_STYLES[item.tone],
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs break-words text-muted">{item.description}</p>
        )}
      </div>
      <button
        onClick={() => dismiss(item.id)}
        aria-label="Bildirimi kapat"
        className="shrink-0 rounded-md p-1 text-subtle transition-soft hover:bg-surface-2 hover:text-content"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2
                 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
