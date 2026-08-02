import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { tr } from "date-fns/locale";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Plus,
  Power,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatTime } from "@/lib/format";
import { useDeviceId } from "@/hooks/useDevice";
import type { CalendarOccurrence, TimeUnit } from "@/lib/types";

const REPEAT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: "never", label: "Tekrarlama" },
  { value: "hourly", label: "Saatlik" },
  { value: "daily", label: "Günlük" },
  { value: "weekly", label: "Haftalık" },
  { value: "monthly", label: "Aylık" },
];

const UNIT_LABELS: Record<TimeUnit, string> = {
  never: "Tek seferlik",
  minutely: "Dakikalık",
  hourly: "Saatlik",
  daily: "Günlük",
  weekly: "Haftalık",
  monthly: "Aylık",
  yearly: "Yıllık",
};

export default function Schedule() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const { data: events } = useQuery({
    queryKey: ["events", deviceId],
    queryFn: () => api.events.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const { data: sequences } = useQuery({
    queryKey: ["sequences", deviceId],
    queryFn: () => api.sequences.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  // Takvim ızgarası: ayın tamamı + kenardaki hafta tamamlayıcı günler
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart.getTime(), gridEnd.getTime()],
  );

  const { data: occurrences } = useQuery({
    queryKey: ["calendar", deviceId, gridStart.toISOString(), gridEnd.toISOString()],
    queryFn: () => api.events.calendar(deviceId!, gridStart, gridEnd),
    enabled: Boolean(deviceId),
  });

  /** Günlere göre gruplanmış çalışma anları — ızgarada hızlı erişim için. */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const occurrence of occurrences ?? []) {
      const key = format(new Date(occurrence.occurs_at), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(occurrence);
      map.set(key, list);
    }
    return map;
  }, [occurrences]);

  const dayOccurrences = byDay.get(format(selectedDay, "yyyy-MM-dd")) ?? [];

  const toggleEvent = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.events.update(deviceId!, id, { is_active: isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", deviceId] });
      void queryClient.invalidateQueries({ queryKey: ["calendar", deviceId] });
    },
    onError: (error) => toast.error("Güncellenemedi", (error as Error).message),
  });

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api.events.remove(deviceId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", deviceId] });
      void queryClient.invalidateQueries({ queryKey: ["calendar", deviceId] });
      toast.success("Görev silindi");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sulama & Takvim"
        description="Zamanlanmış görevler ve tekrar programları"
        icon={<CalendarClock className="size-5" />}
        actions={<Badge tone="brand">{events?.filter((e) => e.is_active).length ?? 0} etkin görev</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        {/* Takvim */}
        <Card>
          <CardHeader
            title={format(month, "LLLL yyyy", { locale: tr })}
            icon={<CalendarClock className="size-4" />}
            action={
              <div className="flex items-center gap-1">
                <Button size="sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Önceki ay">
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setMonth(startOfMonth(new Date()));
                    setSelectedDay(new Date());
                  }}
                >
                  Bugün
                </Button>
                <Button size="sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Sonraki ay">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-7 gap-1.5">
            {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((label) => (
              <div key={label} className="pb-1 text-center text-xs font-semibold text-subtle">
                {label}
              </div>
            ))}

            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const items = byDay.get(key) ?? [];
              const outside = !isSameMonth(day, month);
              const active = isSameDay(day, selectedDay);

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "flex min-h-[4.5rem] flex-col items-start gap-1 rounded-xl border p-2 text-left transition-soft",
                    active
                      ? "border-brand bg-brand/10"
                      : "border-line bg-surface-2 hover:border-line-strong",
                    outside && "opacity-40",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-md text-xs font-semibold",
                      isToday(day) ? "bg-gradient-brand text-white" : "text-content",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {items.slice(0, 2).map((item, index) => (
                    <span
                      key={`${item.event_id}-${index}`}
                      className="w-full truncate rounded bg-brand/15 px-1 py-0.5 text-[0.6rem] text-brand"
                    >
                      {formatTime(item.occurs_at)} {item.title}
                    </span>
                  ))}
                  {items.length > 2 && (
                    <span className="text-[0.6rem] text-subtle">+{items.length - 2} daha</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Seçili günün ayrıntısı */}
          <div className="mt-5 border-t border-line pt-4">
            <h4 className="mb-3 text-sm font-semibold text-content">
              {format(selectedDay, "d MMMM yyyy, EEEE", { locale: tr })}
            </h4>
            {dayOccurrences.length ? (
              <ul className="space-y-2">
                {dayOccurrences.map((item, index) => (
                  <li
                    key={`${item.event_id}-${index}`}
                    className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand">
                      <Droplets className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-content">{item.title}</span>
                    <span className="shrink-0 font-mono text-sm text-brand">
                      {formatTime(item.occurs_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-subtle">Bu gün için planlanmış görev yok</p>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <NewEventForm sequences={sequences ?? []} />

          <Card>
            <CardHeader title="Tüm Görevler" icon={<Power className="size-4" />} />
            {events?.length ? (
              <ul className="space-y-2.5">
                {events.map((event) => (
                  <li key={event.id} className="rounded-xl bg-surface-2 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-content">
                          {event.title || "Görev"}
                        </p>
                        <p className="mt-0.5 text-xs text-subtle">
                          {UNIT_LABELS[event.time_unit]}
                          {event.repeat_every > 1 && ` · ${event.repeat_every}×`}
                        </p>
                      </div>
                      <Toggle
                        checked={event.is_active}
                        onChange={(next) => toggleEvent.mutate({ id: event.id, isActive: next })}
                        label={`${event.title} etkin mi`}
                      />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <Badge tone={event.next_run_at ? "brand" : "neutral"}>
                        {event.next_run_at ? formatDateTime(event.next_run_at) : "Planlanmadı"}
                      </Badge>
                      <button
                        onClick={() => deleteEvent.mutate(event.id)}
                        aria-label="Görevi sil"
                        className="rounded-lg p-1.5 text-subtle transition-soft hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<CalendarClock className="size-6" />}
                title="Görev yok"
                description="Yandaki formdan ilk sulama programınızı oluşturun."
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function NewEventForm({ sequences }: { sequences: { id: string; name: string }[] }) {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("Sabah Sulaması");
  const [sequenceId, setSequenceId] = useState("");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [time, setTime] = useState("07:00");
  const [unit, setUnit] = useState<TimeUnit>("daily");

  const create = useMutation({
    mutationFn: () =>
      api.events.create(deviceId!, {
        title,
        executable_id: sequenceId,
        executable_type: "sequence",
        // Yerel saat girdisini UTC'ye çevir — backend her şeyi UTC saklar
        start_time: new Date(`${date}T${time}`).toISOString(),
        repeat_every: unit === "never" ? 0 : 1,
        time_unit: unit,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", deviceId] });
      void queryClient.invalidateQueries({ queryKey: ["calendar", deviceId] });
      toast.success("Görev oluşturuldu");
    },
    onError: (error) => toast.error("Oluşturulamadı", (error as Error).message),
  });

  const canSubmit = Boolean(deviceId && sequenceId);

  return (
    <Card>
      <CardHeader
        title="Yeni Görev"
        subtitle="Bir diziyi zamanla"
        icon={<Plus className="size-4" />}
      />

      {sequences.length === 0 ? (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
          Önce Diziler bölümünden çalıştırılacak bir komut dizisi oluşturmalısınız.
        </p>
      ) : (
        <div className="space-y-3.5">
          <Input name="title" label="Başlık" value={title} onChange={(e) => setTitle(e.target.value)} />

          <Select
            name="sequence"
            label="Çalıştırılacak dizi"
            value={sequenceId}
            onChange={(e) => setSequenceId(e.target.value)}
          >
            <option value="">Seçiniz…</option>
            {sequences.map((sequence) => (
              <option key={sequence.id} value={sequence.id}>
                {sequence.name}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              name="date"
              type="date"
              label="Başlangıç"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              name="time"
              type="time"
              label="Saat"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <Select
            name="unit"
            label="Tekrar"
            value={unit}
            onChange={(e) => setUnit(e.target.value as TimeUnit)}
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <Button
            variant="primary"
            fullWidth
            disabled={!canSubmit}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Görevi Oluştur
          </Button>
        </div>
      )}
    </Card>
  );
}
