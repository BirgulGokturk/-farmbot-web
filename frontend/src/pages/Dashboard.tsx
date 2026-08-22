import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Camera,
  CalendarClock,
  Cpu,
  Gauge,
  Home,
  Leaf,
  MapPin,
  ScrollText,
  Thermometer,
  Wifi,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
  StatTile,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { GardenMiniMap } from "@/components/dashboard/GardenMiniMap";
import { KurulumDurumu } from "@/components/dashboard/KurulumDurumu";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative, formatUptime, wifiPercent } from "@/lib/format";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBot } from "@/store/useBot";
import { cn } from "@/lib/cn";

export default function Dashboard() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const status = useBot((s) => s.status);
  const liveLogs = useBot((s) => s.logs);

  const { data: points } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const { data: allSensors } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId!),
    enabled: Boolean(deviceId),
  });

  // Fiziksel olarak takılı olmayanlar panoda hiç görünmesin. Arduino, sensör
  // bağlı olmayan analog pini de okuyor ve boştaki pin gürültü üretiyor;
  // "Yağmur" satırının sensör takılı değilken görünmesinin sebebi buydu.
  const sensors = useMemo(
    () => (allSensors ?? []).filter((sensor) => sensor.installed),
    [allSensors],
  );

  // Sensör kartları yalnızca WebSocket'ten gelen canlı ölçümlerle besleniyordu.
  // Sayfa yeni açıldığında henüz mesaj gelmediği için hepsi "—" görünüyordu ve
  // Arduino susmuşsa hiç dolmuyordu. Sunucudaki son değeri başlangıç olarak
  // alıyoruz; canlı mesaj gelince üzerine yazıyor.
  const { data: latest } = useQuery({
    queryKey: ["latest-readings", deviceId],
    queryFn: () => api.hardware.latestReadings(deviceId!),
    enabled: Boolean(deviceId),
    refetchInterval: 60_000,
  });

  const latestBySensor = useMemo(() => {
    const map: Record<string, { value: number; read_at: string }> = {};
    for (const reading of latest ?? []) {
      if (reading.sensor_id) {
        map[reading.sensor_id] = { value: reading.value, read_at: reading.read_at };
      }
    }
    return map;
  }, [latest]);

  const { data: events } = useQuery({
    queryKey: ["events", deviceId, "active"],
    queryFn: () => api.events.list(deviceId!, true),
    enabled: Boolean(deviceId),
  });

  const { data: storedLogs } = useQuery({
    queryKey: ["logs", deviceId, "recent"],
    queryFn: () => api.logs.list(deviceId!, { limit: 8 }),
    enabled: Boolean(deviceId),
  });

  const position = status?.position ?? { x: device?.last_x ?? 0, y: device?.last_y ?? 0, z: device?.last_z ?? 0 };
  const info = status?.informational ?? {};
  const plants = points?.filter((p) => p.point_type === "plant") ?? [];

  // Canlı akış varsa onu göster, yoksa veritabanındaki son kayıtlara düş
  const logs = liveLogs.length
    ? liveLogs.slice(0, 8)
    : (storedLogs?.items ?? []).map((l) => ({ ...l, id: String(l.id) }));

  const upcoming = [...(events ?? [])]
    .filter((e) => e.next_run_at)
    .sort((a, b) => (a.next_run_at! < b.next_run_at! ? -1 : 1))
    .slice(0, 4);

  // Kurulum şeridi su pompasının tanımlı olup olmadığına bakıyor
  const { data: peripherals } = useQuery({
    queryKey: ["peripherals", deviceId],
    queryFn: () => api.hardware.peripherals(deviceId!),
    enabled: Boolean(deviceId),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={device?.name ?? "Kontrol Merkezi"}
        description={device ? `${device.model} · ${device.timezone}` : "Robot durumu"}
        icon={<Gauge className="size-5" />}
        actions={<QuickActions />}
      />

      {/* Ne eksik — hepsi tamamsa kendini gizliyor */}
      <KurulumDurumu device={device} peripherals={peripherals} />

      {/* Özet metrikler */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Konum"
          value={`${Math.round(position.x)} · ${Math.round(position.y)}`}
          unit="mm"
          icon={<MapPin className="size-4" />}
          hint={`Z ekseni: ${Math.round(position.z)} mm`}
        />
        <StatTile
          label="Bitki"
          value={plants.length}
          unit="adet"
          icon={<Leaf className="size-4" />}
          tone="success"
          hint={`${plants.filter((p) => p.stage === "planted" || p.stage === "active").length} tanesi ekili`}
        />
        <StatTile
          label="Çalışma Süresi"
          value={formatUptime(info.uptime as number | undefined)}
          icon={<Activity className="size-4" />}
          tone="info"
          hint={status?.busy ? "Komut çalışıyor" : "Boşta"}
        />
        <StatTile
          label="Bağlantı"
          value={wifiPercent(info.wifi_level as number | undefined) ?? "—"}
          unit={info.wifi_level !== undefined ? "%" : undefined}
          icon={<Wifi className="size-4" />}
          tone={status?.online ? "brand" : "danger"}
          hint={status?.online ? "Çevrimiçi" : "Robot bağlı değil"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Bahçe önizlemesi */}
        <Card className="xl:col-span-2" flush>
          <div className="p-5 pb-0">
            <CardHeader
              title="Bahçe Görünümü"
              subtitle={
                device
                  ? `${(device.bed_width_mm / 1000).toFixed(1)} × ${(device.bed_length_mm / 1000).toFixed(1)} m çalışma alanı`
                  : undefined
              }
              icon={<MapPin className="size-4" />}
              action={
                <Link to="/designer">
                  <Button size="sm">Tasarımcıyı Aç</Button>
                </Link>
              }
            />
          </div>
          <div className="px-5 pb-5">
            {device ? (
              <GardenMiniMap device={device} points={points ?? []} position={position} />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </div>
        </Card>

        {/* Sistem sağlığı */}
        <Card>
          <CardHeader
            title="Sistem Sağlığı"
            subtitle="Raspberry Pi telemetrisi"
            icon={<Cpu className="size-4" />}
          />
          <div className="space-y-3.5">
            <HealthBar
              label="İşlemci"
              value={info.cpu_usage as number | undefined}
              unit="%"
            />
            <HealthBar label="Bellek" value={info.memory_usage as number | undefined} unit="%" />
            <HealthBar label="Disk" value={info.disk_usage as number | undefined} unit="%" />
            <div className="flex items-center justify-between border-t border-line pt-3.5">
              {/* "İşlemci sıcaklığı" — sadece "Sıcaklık" yazınca aşağıdaki
                  Sensörler kartındaki hava sıcaklığıyla karışıyordu. İkisi
                  ayrı şey: bu Pi'nin çipi, o bahçenin havası. */}
              <span className="flex items-center gap-2 text-sm text-muted">
                <Thermometer className="size-4" />
                İşlemci sıcaklığı
              </span>
              <span className="font-mono text-sm text-content">
                {info.soc_temp !== undefined ? `${Number(info.soc_temp).toFixed(1)} °C` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Yazılım</span>
              <span className="font-mono text-sm text-content">
                {(info.firmware_version as string) ?? device?.firmware_version ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Son iletişim</span>
              <span className="text-sm text-content">
                {formatRelative(status?.last_seen_at ?? device?.last_seen_at)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sensörler */}
        <Card>
          <CardHeader
            title="Sensörler"
            subtitle="Son ölçümler"
            icon={<Thermometer className="size-4" />}
            action={
              <Link to="/sensors" className="text-sm font-medium text-brand hover:underline">
                Tümü
              </Link>
            }
          />
          {sensors.length ? (
            <ul className="space-y-2.5">
              {sensors.map((sensor) => (
                <SensorRow
                  key={sensor.id}
                  sensorId={sensor.id}
                  label={sensor.label}
                  unit={sensor.unit}
                  icon={sensor.icon}
                  fallback={latestBySensor[sensor.id]}
                />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-subtle">Tanımlı sensör yok</p>
          )}
        </Card>

        {/* Sıradaki görevler */}
        <Card>
          <CardHeader
            title="Sıradaki Görevler"
            subtitle="Zamanlanmış işler"
            icon={<CalendarClock className="size-4" />}
            action={
              <Link to="/schedule" className="text-sm font-medium text-brand hover:underline">
                Takvim
              </Link>
            }
          />
          {upcoming.length ? (
            <ul className="space-y-2.5">
              {upcoming.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm text-content">
                    {event.title || "Görev"}
                  </span>
                  <Badge tone="brand" className="shrink-0">
                    {formatDateTime(event.next_run_at)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<CalendarClock className="size-6" />}
              title="Planlanmış görev yok"
              description="Takvim bölümünden sulama programı oluşturabilirsiniz."
            />
          )}
        </Card>

        {/* Son olaylar */}
        <Card>
          <CardHeader
            title="Son Olaylar"
            subtitle="Canlı kayıt akışı"
            icon={<ScrollText className="size-4" />}
            action={
              <Link to="/logs" className="text-sm font-medium text-brand hover:underline">
                Tümü
              </Link>
            }
          />
          {logs.length ? (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li key={log.id} className="flex items-start gap-2.5 text-sm">
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      log.level === "error"
                        ? "bg-danger"
                        : log.level === "warn"
                          ? "bg-warning"
                          : log.level === "success"
                            ? "bg-success"
                            : "bg-subtle",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-content">{log.message}</span>
                    <span className="text-xs text-subtle">{formatRelative(log.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<ScrollText className="size-6" />}
              title="Henüz kayıt yok"
              description="Robot bağlandığında olaylar burada görünecek."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function QuickActions() {
  const deviceId = useDeviceId();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, successMessage: string) {
    if (!deviceId) return;
    setBusy(key);
    try {
      await action();
      toast.success(successMessage);
    } catch (error) {
      toast.error("Komut gönderilemedi", (error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        size="sm"
        icon={<Home className="size-4" />}
        loading={busy === "home"}
        onClick={() => run("home", () => api.control.home(deviceId!, { axis: "all" }), "Eve dönülüyor")}
      >
        Eve Dön
      </Button>
      <Button
        size="sm"
        icon={<Camera className="size-4" />}
        loading={busy === "photo"}
        onClick={() => run("photo", () => api.control.takePhoto(deviceId!), "Fotoğraf çekiliyor")}
      >
        Fotoğraf Çek
      </Button>
    </>
  );
}

function HealthBar({ label, value, unit }: { label: string; value: number | undefined; unit: string }) {
  const percent = Math.max(0, Math.min(100, value ?? 0));
  const tone = percent > 85 ? "bg-danger" : percent > 65 ? "bg-warning" : "bg-gradient-brand";

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-mono text-sm text-content">
          {value !== undefined ? `${Math.round(value)}${unit}` : "—"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("h-full rounded-full transition-all duration-500", tone)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SensorRow({
  sensorId,
  label,
  unit,
  icon,
  fallback,
}: {
  sensorId: string;
  label: string;
  unit: string;
  icon: string;
  /** Sunucudaki son kayıtlı ölçüm — canlı mesaj gelene kadar bu gösterilir. */
  fallback?: { value: number; read_at: string };
}) {
  const live = useBot((s) => s.lastReadings[sensorId]);
  const reading = live ?? fallback;

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="text-base">{icon}</span>
        <span className="truncate text-sm text-content">{label}</span>
      </span>
      <span className="shrink-0 font-mono text-sm text-brand">
        {reading ? `${reading.value.toFixed(1)} ${unit}` : "—"}
      </span>
    </li>
  );
}
