import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, ListTree, RefreshCw, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useDeviceId } from "@/hooks/useDevice";
import { useBot } from "@/store/useBot";
import type { Sensor } from "@/lib/types";

const RANGES = [
  { hours: 6, label: "6 saat" },
  { hours: 24, label: "24 saat" },
  { hours: 24 * 7, label: "7 gün" },
  { hours: 24 * 30, label: "30 gün" },
];

export default function Sensors() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24);

  const { data: sensors, isLoading } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId!),
    enabled: Boolean(deviceId),
  });

  /**
   * Gerçek donanım bağlanmadan önce simülatör sanal veri üretmiş olur.
   * Sanal ve gerçek ölçümler aynı grafikte karışınca okunamaz hâle gelir;
   * bu düğme geçmişi temizleyip sıfırdan başlamayı sağlar.
   */
  const clearHistory = useMutation({
    mutationFn: () => api.hardware.clearReadings(deviceId!),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["sensor-series"] });
      void queryClient.invalidateQueries({ queryKey: ["spatial", deviceId] });
      toast.success("Geçmiş temizlendi", result.detail);
    },
    onError: (error) => toast.error("Temizlenemedi", (error as Error).message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sensörler"
        description="Anlık değerler ve geçmiş ölçümler"
        icon={<ListTree className="size-5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-4" />}
              loading={clearHistory.isPending}
              onClick={() => clearHistory.mutate()}
            >
              Geçmişi Temizle
            </Button>
            <Select
              name="range"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="w-36"
            >
              {RANGES.map((range) => (
                <option key={range.hours} value={range.hours}>
                  {range.label}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {isLoading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : sensors?.length ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {sensors.map((sensor) => (
            <SensorCard key={sensor.id} sensor={sensor} hours={hours} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<ListTree className="size-6" />}
            title="Tanımlı sensör yok"
            description="Ayarlar bölümünden sensör ekleyerek toprak nemi, sıcaklık ve ışık ölçümlerini izleyebilirsiniz."
          />
        </Card>
      )}
    </div>
  );
}

function SensorCard({ sensor, hours }: { sensor: Sensor; hours: number }) {
  const deviceId = useDeviceId();
  const live = useBot((s) => s.lastReadings[sensor.id]);
  const [reading, setReading] = useState(false);

  const { data: series, refetch } = useQuery({
    queryKey: ["sensor-series", deviceId, sensor.id, hours],
    queryFn: () => api.hardware.series(deviceId!, sensor.id, hours),
    enabled: Boolean(deviceId),
  });

  /**
   * WebSocket'ten gelen ölçümler grafiğe anında eklenir.
   * Önceden grafik yalnızca sayfa açılışında veri çekiyordu; yeni ölçüm
   * gelse bile kullanıcı sayfayı yenilemeden değişimi göremiyordu.
   * Sunucudan tekrar veri istemek yerine noktayı yerelde eklemek hem anında
   * hem de ağ trafiği yaratmadan çalışır.
   */
  const [livePoints, setLivePoints] = useState<{ t: string; v: number }[]>([]);

  useEffect(() => {
    if (!live) return;
    setLivePoints((current) => {
      // Aynı ölçüm iki kez eklenmesin
      if (current.at(-1)?.t === live.read_at) return current;
      // Grafiği sınırla: sonsuz büyümesin
      return [...current, { t: live.read_at, v: live.value }].slice(-200);
    });
  }, [live]);

  // Sunucudan yeni seri gelince yerel tampon sıfırlanır (artık onun içinde)
  useEffect(() => {
    setLivePoints([]);
  }, [series]);

  const points = useMemo(() => {
    const fetched = series?.points ?? [];
    const lastFetched = fetched.at(-1)?.t;
    // Sunucudan gelen son noktadan yeni olanları ekle
    const fresh = lastFetched
      ? livePoints.filter((point) => point.t > lastFetched)
      : livePoints;
    return [...fetched, ...fresh];
  }, [series, livePoints]);

  const chartData = points.map((point) => ({
    time: formatTime(point.t),
    value: point.v,
  }));

  const latest = live?.value ?? points.at(-1)?.v;

  // I²C sensörlerin (BMP180 gibi) GPIO pini yoktur; Arduino bunları her
  // ölçüm turunda kendiliğinden okur, elle tetiklenecek bir pin bulunmaz.
  const canReadOnDemand = sensor.pin !== null;

  async function readNow() {
    if (!deviceId || sensor.pin === null) return;
    setReading(true);
    try {
      await api.control.readPin(deviceId, sensor.pin, sensor.mode);
      toast.success(`${sensor.label} okunuyor`);
      window.setTimeout(() => void refetch(), 1500);
    } catch (error) {
      toast.error("Okuma başarısız", (error as Error).message);
    } finally {
      setReading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={sensor.label}
        subtitle={
          sensor.pin !== null
            ? `GPIO ${sensor.pin} · ${sensor.mode === 1 ? "analog" : "dijital"}`
            : `I²C · ${sensor.channel}`
        }
        icon={<span className="text-lg">{sensor.icon}</span>}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={latest !== undefined ? "brand" : "neutral"}>
              {latest !== undefined ? `${latest.toFixed(1)} ${sensor.unit}` : "veri yok"}
            </Badge>
            {canReadOnDemand && (
              <Button
                size="sm"
                icon={<RefreshCw className="size-3.5" />}
                loading={reading}
                onClick={readNow}
              >
                Oku
              </Button>
            )}
          </div>
        }
      />

      {chartData.length > 1 ? (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id={`grad-${sensor.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "var(--text-subtle)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tick={{ fill: "var(--text-subtle)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 13,
                  color: "var(--text)",
                }}
                labelStyle={{ color: "var(--text-muted)" }}
                formatter={(value) => [`${Number(value).toFixed(1)} ${sensor.unit}`, sensor.label]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--brand)"
                strokeWidth={2}
                fill={`url(#grad-${sensor.id})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="grid h-52 place-items-center rounded-xl bg-surface-2">
          <div className="text-center text-sm text-subtle">
            <Activity className="mx-auto mb-2 size-6" />
            Bu aralıkta yeterli ölçüm yok
          </div>
        </div>
      )}
    </Card>
  );
}
