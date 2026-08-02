/**
 * Bildirim merkezi.
 *
 * Okunmamış sayısı hem düzenli sorgulamayla hem de WebSocket'ten gelen
 * `notification` mesajıyla tazelenir — uyarı üretildiği anda çan güncellenir.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Info,
  XCircle,
  CheckCircle2,
} from "lucide-react";

import { Badge, IconButton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useBot } from "@/store/useBot";
import type { LogLevel } from "@/lib/types";

const LEVEL_STYLE: Record<LogLevel, { Icon: typeof Info; className: string }> = {
  debug: { Icon: Info, className: "text-subtle" },
  info: { Icon: Info, className: "text-info" },
  success: { Icon: CheckCircle2, className: "text-success" },
  warn: { Icon: AlertTriangle, className: "text-warning" },
  error: { Icon: XCircle, className: "text-danger" },
};

export function NotificationBell() {
  const deviceId = useBot((s) => s.deviceId);
  const notificationTick = useBot((s) => s.notificationTick);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["notifications", deviceId],
    queryFn: () => api.alerts.notifications(deviceId!),
    enabled: Boolean(deviceId),
    // Sekme arka plandayken bile makul aralıklarla tazelensin
    refetchInterval: 60_000,
  });

  // WebSocket'ten yeni bildirim haberi gelince listeyi hemen tazele
  useEffect(() => {
    if (notificationTick > 0) {
      void queryClient.invalidateQueries({ queryKey: ["notifications", deviceId] });
    }
  }, [notificationTick, queryClient, deviceId]);

  // Panel dışına tıklanınca kapan
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const markAllRead = useMutation({
    mutationFn: () => api.alerts.markAllRead(deviceId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", deviceId] });
      toast.success("Tüm bildirimler okundu");
    },
    onError: (error) => toast.error("İşaretlenemedi", (error as Error).message),
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.alerts.markRead(deviceId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", deviceId] }),
  });

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="relative" ref={panelRef}>
      <IconButton
        label={unread ? `${unread} okunmamış bildirim` : "Bildirimler"}
        onClick={() => setOpen((value) => !value)}
        className={cn(open && "bg-surface-2 text-content")}
      >
        <span className="relative">
          <Bell className="size-4" />
          {unread > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full
                         bg-gradient-danger px-1 text-[0.6rem] font-bold leading-4 text-white"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </IconButton>

      {open && (
        <div
          className="animate-fade-up absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))]
                     overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-content">Bildirimler</h3>
              {unread > 0 && <Badge tone="danger">{unread} yeni</Badge>}
            </div>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="flex items-center gap-1 text-xs font-medium text-brand transition-soft hover:underline"
              >
                <CheckCheck className="size-3.5" />
                Tümünü okundu say
              </button>
            )}
          </div>

          <div className="max-h-[24rem] overflow-y-auto">
            {items.length ? (
              <ul className="divide-y divide-line">
                {items.map((item) => {
                  const style = LEVEL_STYLE[item.level];
                  const isUnread = item.read_at === null;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => isUnread && markRead.mutate(item.id)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-soft hover:bg-surface-2",
                          isUnread && "bg-brand/5",
                        )}
                      >
                        <style.Icon className={cn("mt-0.5 size-4 shrink-0", style.className)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-content">
                              {item.title}
                            </span>
                            {isUnread && (
                              <span className="size-1.5 shrink-0 rounded-full bg-brand" />
                            )}
                          </span>
                          <span className="mt-0.5 block break-words text-xs text-muted">
                            {item.message}
                          </span>
                          <span className="mt-1 block text-[0.7rem] text-subtle">
                            {formatRelative(item.created_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto mb-2 size-6 text-subtle" />
                <p className="text-sm text-muted">Bildirim yok</p>
                <p className="mt-1 text-xs text-subtle">
                  Ayarlar bölümünden uyarı kuralı tanımlayabilirsiniz.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
