import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText, Search, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useDeviceId } from "@/hooks/useDevice";
import { useBot } from "@/store/useBot";
import type { LogLevel } from "@/lib/types";

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: "text-subtle border-line bg-surface-2",
  info: "text-info border-info/25 bg-info/10",
  success: "text-success border-success/25 bg-success/10",
  warn: "text-warning border-warning/25 bg-warning/10",
  error: "text-danger border-danger/25 bg-danger/10",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Ayıklama",
  info: "Bilgi",
  success: "Başarılı",
  warn: "Uyarı",
  error: "Hata",
};

export default function Logs() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const liveLogs = useBot((s) => s.logs);

  const [level, setLevel] = useState<LogLevel | "">("");
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["logs", deviceId, level, search],
    queryFn: () =>
      api.logs.list(deviceId!, {
        level: level || undefined,
        search: search || undefined,
        limit: 200,
      }),
    enabled: Boolean(deviceId),
  });

  /**
   * Canlı akış ile veritabanı kayıtlarını birleştir.
   * Canlı kayıtlar henüz veritabanı kimliğine sahip olmayabilir, bu yüzden
   * zaman damgası + mesaj ikilisine göre tekilleştiriyoruz.
   */
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const merged: {
      key: string;
      message: string;
      level: LogLevel;
      created_at: string;
      live: boolean;
    }[] = [];

    for (const log of liveLogs) {
      const key = `${log.created_at}|${log.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ key, message: log.message, level: log.level, created_at: log.created_at, live: true });
    }

    for (const log of data?.items ?? []) {
      const key = `${log.created_at}|${log.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        key: String(log.id),
        message: log.message,
        level: log.level,
        created_at: log.created_at,
        live: false,
      });
    }

    // Filtreler canlı kayıtlara da uygulanmalı
    return merged
      .filter((entry) => !level || entry.level === level)
      .filter(
        (entry) =>
          !search || entry.message.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")),
      )
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [liveLogs, data, level, search]);

  async function clearLogs() {
    if (!deviceId) return;
    try {
      await api.logs.clear(deviceId);
      await queryClient.invalidateQueries({ queryKey: ["logs", deviceId] });
      toast.success("Kayıtlar temizlendi");
    } catch (error) {
      toast.error("Temizlenemedi", (error as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kayıtlar"
        description="Robottan gelen olay akışı"
        icon={<ScrollText className="size-5" />}
        actions={
          <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={clearLogs}>
            Temizle
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          name="search"
          placeholder="Kayıtlarda ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          suffix={<Search className="size-4" />}
          className="min-w-56"
        />
        <Select
          name="level"
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | "")}
          className="w-44"
        >
          <option value="">Tüm seviyeler</option>
          {Object.entries(LEVEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <Card flush>
        {entries.length ? (
          <ul className="divide-y divide-line">
            {entries.map((entry) => (
              <li key={entry.key} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-md border px-2 py-0.5 text-[0.7rem] font-medium",
                    LEVEL_STYLES[entry.level],
                  )}
                >
                  {LEVEL_LABELS[entry.level]}
                </span>
                <p className="min-w-0 flex-1 break-words text-sm text-content">{entry.message}</p>
                <span className="shrink-0 font-mono text-xs text-subtle">
                  {formatDateTime(entry.created_at)}
                </span>
                {entry.live && <Badge tone="brand">canlı</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<ScrollText className="size-6" />}
            title="Kayıt bulunamadı"
            description="Robot bağlandığında olaylar buraya anlık olarak düşecek."
          />
        )}
      </Card>
    </div>
  );
}
