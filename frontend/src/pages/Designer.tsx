import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Box,
  CalendarClock,
  Droplets,
  Flame,
  Leaf,
  // Yerleşik `Map` sınıfını gölgelemesin diye takma adla alınıyor
  Map as MapIcon,
  Navigation,
  Radar,
  Redo2,
  RotateCcw,
  Search,
  Sprout,
  Trash2,
  Undo2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  IconButton,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import {
  GardenCanvas,
  type GardenCanvasHandle,
  type PointMove,
} from "@/components/designer/GardenCanvas";
import { usePaletteDrag } from "@/components/designer/usePaletteDrag";
import { useHistory } from "@/components/designer/useHistory";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { growthAt } from "@/lib/growth";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBotPosition } from "@/store/useBot";
import type { PlantSpecies, PlantStage, Point } from "@/lib/types";

// three.js ağır; yalnızca 3D moda geçilince indirilsin

const STAGE_LABELS: Record<PlantStage, string> = {
  planned: "Planlandı",
  planted: "Ekildi",
  sprouted: "Filizlendi",
  active: "Büyüyor",
  harvested: "Hasat edildi",
  removed: "Kaldırıldı",
};

/** Zaman kaydırıcısının kapsadığı aralık (bugüne göre gün). */
const TIME_RANGE = { min: -60, max: 240 };

export default function Designer() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const queryClient = useQueryClient();
  const botPosition = useBotPosition();
  const history = useHistory();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [dayOffset, setDayOffset] = useState(0);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [heatSensorId, setHeatSensorId] = useState<string>("");
  const canvasRef = useRef<GardenCanvasHandle>(null);

  const viewDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    return date;
  }, [dayOffset]);

  // --- Veri ---------------------------------------------------------------- //

  const { data: points, isLoading } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const { data: species } = useQuery({
    queryKey: ["species"],
    queryFn: () => api.catalog.species(),
  });

  const { data: curveList } = useQuery({
    queryKey: ["curves", deviceId],
    queryFn: () => api.catalog.curves(deviceId!),
    enabled: Boolean(deviceId),
  });

  const { data: sensors } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId!),
    enabled: Boolean(deviceId),
  });

  /**
   * Isı haritasında yalnızca **toprak nemi** gösteriliyor.
   *
   * Diğer sensörler robotun ucunda değil, gövdesinde duruyor: hava sıcaklığı,
   * basınç, rakım ve yağmur yatağın her noktasında aynı değeri veriyor. Onları
   * haritaya çizmek "bahçenin şu köşesi kuru" gibi bir bilgi üretmiyor, sadece
   * ölçüm gürültüsünü renklendiriyordu. Toprak nemi ise robot her noktaya
   * indiğinde farklı okuyor — haritası anlamlı olan tek ölçüm bu.
   */
  const heatmapSensors = useMemo(
    () =>
      (sensors ?? []).filter(
        (sensor) => sensor.kind === "soil_moisture" && sensor.installed,
      ),
    [sensors],
  );

  useEffect(() => {
    const usable = heatmapSensors.some((sensor) => sensor.id === heatSensorId);
    if (!usable) setHeatSensorId(heatmapSensors[0]?.id ?? "");
  }, [heatmapSensors, heatSensorId]);

  const heatSensor = heatmapSensors.find((sensor) => sensor.id === heatSensorId);

  const { data: heatReadings } = useQuery({
    queryKey: ["spatial", deviceId, heatSensorId],
    queryFn: () => api.hardware.spatialReadings(deviceId!, { sensor_id: heatSensorId, hours: 168 }),
    enabled: Boolean(deviceId) && heatmapOn && Boolean(heatSensorId),
    // Ölçüm turu sürerken harita kendiliğinden dolsun
    refetchInterval: heatmapOn ? 5000 : false,
  });

  /** Kaç farklı noktadan ölçüm var — haritanın anlamlı olup olmadığını belirler. */
  const distinctSpots = useMemo(
    () =>
      new Set(
        (heatReadings ?? []).map((r) => `${Math.round(r.x / 400)}:${Math.round(r.y / 400)}`),
      ).size,
    [heatReadings],
  );

  const curves = useMemo(
    () => new Map((curveList ?? []).map((curve) => [curve.id, curve])),
    [curveList],
  );

  const selectedPoints = useMemo(
    () => (points ?? []).filter((point) => selectedIds.includes(point.id)),
    [points, selectedIds],
  );

  // Silinen bir bitki seçili kalmasın
  useEffect(() => {
    if (!points) return;
    const alive = new Set(points.map((p) => p.id));
    setSelectedIds((current) => {
      const filtered = current.filter((id) => alive.has(id));
      return filtered.length === current.length ? current : filtered;
    });
  }, [points]);

  const refreshPoints = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["points", deviceId] }),
    [queryClient, deviceId],
  );

  // --- Değişiklikler (hepsi geçmişe kaydedilir) ---------------------------- //

  const createPoint = useMutation({
    mutationFn: ({ species: s, x, y }: { species: PlantSpecies; x: number; y: number }) =>
      api.points.create(deviceId!, {
        name: s.name_tr,
        x,
        y,
        species_id: s.id,
        radius_mm: s.spread_mm / 2,
        depth_mm: s.sow_depth_mm,
      }),
    onSuccess: async (point) => {
      await refreshPoints();
      setSelectedIds([point.id]);
      // Yumuşak silme + geri yükleme sayesinde ekleme geri alınabilir
      history.push({
        label: `${point.name} eklendi`,
        undo: async () => {
          await api.points.remove(deviceId!, point.id);
          await refreshPoints();
        },
        redo: async () => {
          await api.points.restore(deviceId!, point.id);
          await refreshPoints();
        },
      });
      toast.success(`${point.name} eklendi`, `X ${Math.round(point.x)} · Y ${Math.round(point.y)}`);
    },
    onError: (error) => toast.error("Bitki eklenemedi", (error as Error).message),
  });

  const movePoints = useMutation({
    mutationFn: (moves: PointMove[]) => api.points.bulkMove(deviceId!, moves),
    onMutate: async (moves) => {
      // İyimser güncelleme: sürükleme bitince bitkiler geri zıplamasın
      await queryClient.cancelQueries({ queryKey: ["points", deviceId] });
      const snapshot = queryClient.getQueryData<Point[]>(["points", deviceId]);
      const byId = new Map(moves.map((move) => [move.id, move]));
      queryClient.setQueryData<Point[]>(["points", deviceId], (old) =>
        old?.map((point) => {
          const move = byId.get(point.id);
          return move ? { ...point, x: move.x, y: move.y } : point;
        }),
      );
      return { snapshot };
    },
    onError: (error, _moves, context) => {
      queryClient.setQueryData(["points", deviceId], context?.snapshot);
      toast.error("Taşıma kaydedilemedi", (error as Error).message);
    },
    onSettled: () => void refreshPoints(),
  });

  const handleMovePoints = useCallback(
    (moves: PointMove[], previous: PointMove[]) => {
      movePoints.mutate(moves);
      history.push({
        label: moves.length > 1 ? `${moves.length} bitki taşındı` : "Bitki taşındı",
        undo: async () => {
          await api.points.bulkMove(deviceId!, previous);
          await refreshPoints();
        },
        redo: async () => {
          await api.points.bulkMove(deviceId!, moves);
          await refreshPoints();
        },
      });
    },
    [movePoints, history, deviceId, refreshPoints],
  );

  const updatePoint = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.points.update>[2] }) =>
      api.points.update(deviceId!, id, patch),
    onSuccess: () => void refreshPoints(),
    onError: (error) => toast.error("Güncellenemedi", (error as Error).message),
  });

  const deleteSelected = useCallback(async () => {
    if (!deviceId || selectedPoints.length === 0) return;
    const ids = selectedPoints.map((point) => point.id);
    const label =
      ids.length > 1 ? `${ids.length} bitki kaldırıldı` : `${selectedPoints[0].name} kaldırıldı`;

    try {
      await Promise.all(ids.map((id) => api.points.remove(deviceId, id)));
      await refreshPoints();
      setSelectedIds([]);
      history.push({
        label,
        undo: async () => {
          await Promise.all(ids.map((id) => api.points.restore(deviceId, id)));
          await refreshPoints();
        },
        redo: async () => {
          await Promise.all(ids.map((id) => api.points.remove(deviceId, id)));
          await refreshPoints();
        },
      });
      toast.success(label);
    } catch (error) {
      toast.error("Silinemedi", (error as Error).message);
    }
  }, [deviceId, selectedPoints, refreshPoints, history]);

  // --- Klavye kısayolları --------------------------------------------------- //

  useEffect(() => {
    async function onKeyDown(event: KeyboardEvent) {
      // Form alanındayken kısayollar devreye girmesin
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const label = event.shiftKey ? await history.redo() : await history.undo();
        if (label) toast.info(event.shiftKey ? "Yinelendi" : "Geri alındı", label);
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        const label = await history.redo();
        if (label) toast.info("Yinelendi", label);
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds((points ?? []).map((point) => point.id));
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds([]);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.length) {
          event.preventDefault();
          void deleteSelected();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, points, selectedIds, deleteSelected]);

  // --- Paletten sürükleme --------------------------------------------------- //

  const handleDrop = useCallback(
    (item: PlantSpecies, clientX: number, clientY: number) => {
      const world = canvasRef.current?.screenToWorld(clientX, clientY);
      if (!world) return;
      createPoint.mutate({ species: item, x: world.x, y: world.y });
    },
    [createPoint],
  );

  const canDrop = useCallback(
    (clientX: number, clientY: number) => canvasRef.current?.hitTest(clientX, clientY) ?? false,
    [],
  );

  const paletteDrag = usePaletteDrag({ onDrop: handleDrop, canDrop });

  const filteredSpecies = useMemo(() => {
    if (!species) return [];
    const query = search.trim().toLocaleLowerCase("tr");
    if (!query) return species;
    return species.filter((s) => s.name_tr.toLocaleLowerCase("tr").includes(query));
  }, [species, search]);

  const plantCount = points?.filter((p) => p.point_type === "plant").length ?? 0;

  async function runUndo() {
    const label = await history.undo();
    if (label) toast.info("Geri alındı", label);
  }
  async function runRedo() {
    const label = await history.redo();
    if (label) toast.info("Yinelendi", label);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tarla Tasarımcısı"
        description="Bitkileri paletten sürükleyip bahçeye bırakın"
        icon={<MapIcon className="size-5" />}
        actions={
          <>
            <IconButton
              label={history.canUndo ? `Geri al: ${history.nextUndoLabel}` : "Geri al"}
              size="sm"
              onClick={runUndo}
              disabled={!history.canUndo || history.busy}
            >
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton
              label={history.canRedo ? `Yinele: ${history.nextRedoLabel}` : "Yinele"}
              size="sm"
              onClick={runRedo}
              disabled={!history.canRedo || history.busy}
            >
              <Redo2 className="size-4" />
            </IconButton>
            <Badge tone="brand">{plantCount} bitki</Badge>
            {device && (
              <Badge>
                {(device.bed_width_mm / 1000).toFixed(1)} × {(device.bed_length_mm / 1000).toFixed(1)} m
              </Badge>
            )}
          </>
        }
      />

      {/* Zaman yolculuğu ve katmanlar */}
      <Card className="py-3.5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-[280px] flex-1 items-center gap-3">
            <CalendarClock className="size-4 shrink-0 text-brand" />
            <input
              type="range"
              min={TIME_RANGE.min}
              max={TIME_RANGE.max}
              value={dayOffset}
              onChange={(event) => setDayOffset(Number(event.target.value))}
              aria-label="Görüntülenen tarih"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 outline-none
                         [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand
                         [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full
                         [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand"
            />
            <span
              className={cn(
                "w-32 shrink-0 text-right text-sm font-medium tabular-nums",
                dayOffset === 0 ? "text-muted" : "text-brand",
              )}
            >
              {dayOffset === 0 ? "Bugün" : formatDate(viewDate)}
            </span>
            {dayOffset !== 0 && (
              <IconButton label="Bugüne dön" size="sm" onClick={() => setDayOffset(0)}>
                <RotateCcw className="size-3.5" />
              </IconButton>
            )}
          </div>

          {/* 3D artık burada değil.
              Aynı sahnenin iki ayrı kopyasını (Garden3D ve Viewer3D) sürdürmek
              hem bakımı ikiye katlıyor hem de three.js'i (gzip ~300 kB) bu
              sayfaya da yüklüyordu. Tasarımcı yerleştirme için kuşbakışı
              kalıyor; 3D ve tüm görünüm ayarları tek yerde. */}
          <Link
            to="/viewer"
            className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted transition-soft hover:text-brand"
          >
            <Box className="size-3.5" />
            3D Görünüm
          </Link>

          {/* Isı haritası */}
          {(
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <Flame className="size-4" />
                Isı haritası
              </span>
              <Toggle
                checked={heatmapOn}
                onChange={setHeatmapOn}
                label="Isı haritası"
                tone="warning"
                disabled={!heatmapSensors.length}
              />
              {/* Birden çok toprak nemi sensörü varsa seçim gerekir; tek
                  sensörde açılır kutu göstermek boş yere yer kaplıyor. */}
              {heatmapOn && heatmapSensors.length > 1 && (
                <Select
                  name="heatSensor"
                  value={heatSensorId}
                  onChange={(event) => setHeatSensorId(event.target.value)}
                  className="h-8 w-40 text-xs"
                >
                  {heatmapSensors.map((sensor) => (
                    <option key={sensor.id} value={sensor.id}>
                      {sensor.label} ({sensor.unit || "birimsiz"})
                    </option>
                  ))}
                </Select>
              )}
              {!heatmapSensors.length && (
                <span className="text-xs text-subtle">Toprak nemi sensörü tanımlı değil</span>
              )}
            </div>
          )}
        </div>

        {/* Isı haritası durumu ve veri toplama */}
        {heatmapOn && (
          <HeatmapStatus
            sensor={heatSensor}
            readings={heatReadings ?? []}
            distinctSpots={distinctSpots}
          />
        )}

        {dayOffset !== 0 && (
          <p className="mt-2.5 rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand">
            {dayOffset > 0 ? "Gelecek" : "Geçmiş"} görünümü — bitkiler {formatDate(viewDate)}{" "}
            tarihindeki boyutlarıyla çiziliyor. Bu görünümde yapılan düzenlemeler yine bugünün
            verisine işlenir.
          </p>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[260px_1fr_300px]">
        {/* Bitki paleti */}
        <Card className="order-2 xl:order-1">
          <CardHeader title="Bitki Paleti" icon={<Leaf className="size-4" />} />
          <Input
            name="search"
            placeholder="Bitki ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            suffix={<Search className="size-4" />}
            className="mb-3"
          />
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 xl:grid-cols-1">
            {filteredSpecies.map((item) => (
              <button
                key={item.id}
                onPointerDown={(event) => {
                  event.preventDefault();
                  paletteDrag.start(item, event.clientX, event.clientY);
                }}
                className={cn(
                  "flex touch-none items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5",
                  "cursor-grab text-left transition-soft hover:border-brand/40 hover:bg-surface-3 active:cursor-grabbing",
                  paletteDrag.ghost?.species.id === item.id && "border-brand opacity-50",
                )}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-medium text-content">
                    {item.name_tr}
                  </span>
                  <span className="text-[0.7rem] text-subtle">{item.spread_mm} mm aralık</span>
                </span>
              </button>
            ))}
            {!filteredSpecies.length && (
              <p className="col-span-full py-6 text-center text-sm text-subtle">Eşleşen bitki yok</p>
            )}
          </div>
        </Card>

        {/* Tuval */}
        <div className="order-1 h-[62vh] min-h-[420px] xl:order-2 xl:h-[calc(100vh-20rem)]">
          {isLoading || !device ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <GardenCanvas
              ref={canvasRef}
              device={device}
              points={points ?? []}
              botPosition={botPosition}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onMovePoints={handleMovePoints}
              dropActive={paletteDrag.dragging}
              viewDate={viewDate}
              curves={curves}
              heatmap={heatmapOn ? (heatReadings ?? []) : null}
              heatRange={
                heatSensor
                  ? { min: heatSensor.min_value, max: heatSensor.max_value }
                  : undefined
              }
              onSendBot={async (x, y) => {
                if (!deviceId) return;
                try {
                  await api.control.moveAbsolute(deviceId, { x, y, z: 0 });
                  toast.success("Robot gönderiliyor", `X ${x} · Y ${y}`);
                } catch (error) {
                  toast.error("Komut gönderilemedi", (error as Error).message);
                }
              }}
            />
          )}
        </div>

        {/* Sağ panel */}
        <div className="order-3">
          {selectedPoints.length > 1 ? (
            <BulkPanel
              points={selectedPoints}
              onDelete={deleteSelected}
              onStageChange={(stage) => {
                for (const point of selectedPoints) {
                  updatePoint.mutate({ id: point.id, patch: { stage } });
                }
                toast.success(`${selectedPoints.length} bitki güncellendi`);
              }}
            />
          ) : selectedPoints.length === 1 ? (
            <PointInspector
              point={selectedPoints[0]}
              viewDate={viewDate}
              curves={curves}
              onChange={(patch) => updatePoint.mutate({ id: selectedPoints[0].id, patch })}
              onDelete={deleteSelected}
            />
          ) : (
            <Card>
              <CardHeader title="Seçim" icon={<Sprout className="size-4" />} />
              <p className="py-5 text-center text-sm text-subtle">
                Ayrıntılar için bahçeden bir bitki seçin.
              </p>
              <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
                <Shortcut keys="Sürükle" text="görünümü kaydır" />
                <Shortcut keys="Shift + sürükle" text="kutuyla çoklu seçim" />
                <Shortcut keys="Ctrl + tıkla" text="seçime ekle / çıkar" />
                <Shortcut keys="Ctrl + tekerlek" text="yakınlaştır" />
                <Shortcut keys="Çift tıkla" text="robotu oraya gönder" />
                <Shortcut keys="Ctrl + Z / Y" text="geri al / yinele" />
                <Shortcut keys="Delete" text="seçilileri kaldır" />
              </div>
            </Card>
          )}
        </div>
      </div>

      {paletteDrag.ghost && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 text-3xl drop-shadow-lg"
          style={{ left: paletteDrag.ghost.clientX, top: paletteDrag.ghost.clientY }}
          aria-hidden
        >
          {paletteDrag.ghost.species.icon}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Isı haritasının neden boş göründüğünü açıklar ve veriyi toplamanın yolunu sunar.
 * Önceden katman sessizce boş kalıyordu: robot hiç gezmediği için tüm ölçümler
 * tek noktadaydı ve haritada görünmüyordu.
 */
function HeatmapStatus({
  sensor,
  readings,
  distinctSpots,
}: {
  sensor: import("@/lib/types").Sensor | undefined;
  readings: import("@/lib/types").SpatialReading[];
  distinctSpots: number;
}) {
  const deviceId = useDeviceId();
  const [running, setRunning] = useState(false);

  async function startSurvey() {
    if (!deviceId || !sensor) return;
    setRunning(true);
    try {
      const response = await api.control.survey(deviceId, {
        sensor_id: sensor.id,
        columns: 4,
        rows: 3,
      });
      toast.success(
        "Ölçüm turu başladı",
        response.detail ?? "Robot bahçeyi gezerken harita dolacak.",
      );
    } catch (error) {
      toast.error("Tur başlatılamadı", (error as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (!sensor) {
    return (
      <p className="mt-2.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
        Isı haritası için önce Ayarlar bölümünden bir sensör tanımlamalısınız.
      </p>
    );
  }

  // İki farklı noktadan azsa harita bir leke olmaktan öteye geçmez
  const tooSparse = distinctSpots < 2;

  return (
    <div
      className={cn(
        "mt-2.5 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-xs",
        tooSparse ? "bg-warning/10 text-warning" : "bg-surface-2 text-muted",
      )}
    >
      <span className="flex-1">
        {tooSparse ? (
          <>
            <strong>Harita için yeterli veri yok.</strong> {sensor.label} yalnızca{" "}
            {distinctSpots} noktadan ölçülmüş. Robotun bahçeyi gezip farklı noktalardan
            ölçüm alması gerekiyor.
          </>
        ) : (
          <>
            {sensor.label} · {readings.length} ölçüm, {distinctSpots} farklı nokta ·{" "}
            <span className="text-danger">kırmızı düşük</span> →{" "}
            <span className="text-info">mavi yüksek</span> ({sensor.min_value}–
            {sensor.max_value} {sensor.unit})
          </>
        )}
      </span>
      <Button size="sm" icon={<Radar className="size-3.5" />} loading={running} onClick={startSurvey}>
        Ölçüm Turu Yap
      </Button>
    </div>
  );
}

function Shortcut({ keys, text }: { keys: string; text: string }) {
  return (
    <p className="flex items-center gap-2">
      <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.65rem] text-muted">
        {keys}
      </kbd>
      <span>{text}</span>
    </p>
  );
}

function BulkPanel({
  points,
  onDelete,
  onStageChange,
}: {
  points: Point[];
  onDelete: () => void;
  onStageChange: (stage: PlantStage) => void;
}) {
  const deviceId = useDeviceId();
  const [watering, setWatering] = useState(false);

  const totalWater = points.reduce(
    (sum, point) => sum + (point.species?.water_ml_per_day ?? 200),
    0,
  );

  async function waterAll() {
    if (!deviceId) return;
    setWatering(true);
    try {
      // Sırayla gönderiliyor: robot komutları zaten tek tek uyguluyor
      for (const point of points) {
        await api.control.water(deviceId, {
          point_id: point.id,
          volume_ml: point.species?.water_ml_per_day ?? 200,
        });
      }
      toast.success(`${points.length} bitki sulanıyor`, `Toplam ~${totalWater} ml`);
    } catch (error) {
      toast.error("Sulama başlatılamadı", (error as Error).message);
    } finally {
      setWatering(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`${points.length} bitki seçili`}
        subtitle="Toplu işlem"
        icon={<Sprout className="size-4" />}
      />

      <div className="mb-4 max-h-32 space-y-1 overflow-y-auto rounded-xl bg-surface-2 p-2.5">
        {points.slice(0, 12).map((point) => (
          <p key={point.id} className="flex items-center gap-2 text-xs text-muted">
            <span>{point.species?.icon ?? "📍"}</span>
            <span className="truncate">{point.name}</span>
            <span className="ml-auto shrink-0 font-mono text-subtle">
              {Math.round(point.x)},{Math.round(point.y)}
            </span>
          </p>
        ))}
        {points.length > 12 && (
          <p className="pt-1 text-center text-xs text-subtle">+{points.length - 12} bitki daha</p>
        )}
      </div>

      <div className="space-y-3">
        <Select
          name="bulkStage"
          label="Aşamayı hepsi için değiştir"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) onStageChange(event.target.value as PlantStage);
          }}
        >
          <option value="">Seçiniz…</option>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Button
          fullWidth
          icon={<Droplets className="size-4" />}
          loading={watering}
          onClick={waterAll}
        >
          Hepsini Sula (~{totalWater} ml)
        </Button>

        <Button
          variant="danger"
          fullWidth
          icon={<Trash2 className="size-4" />}
          onClick={onDelete}
        >
          {points.length} Bitkiyi Kaldır
        </Button>
      </div>
    </Card>
  );
}

function PointInspector({
  point,
  viewDate,
  curves,
  onChange,
  onDelete,
}: {
  point: Point;
  viewDate: Date;
  curves: Map<string, import("@/lib/types").Curve>;
  onChange: (patch: { name?: string; stage?: PlantStage }) => void;
  onDelete: () => void;
}) {
  const deviceId = useDeviceId();
  const [name, setName] = useState(point.name);
  const [watering, setWatering] = useState(false);

  useEffect(() => setName(point.name), [point.id, point.name]);

  const growth = growthAt(point, viewDate, curves);

  async function waterNow() {
    if (!deviceId) return;
    setWatering(true);
    try {
      await api.control.water(deviceId, {
        point_id: point.id,
        volume_ml: point.species?.water_ml_per_day ?? 200,
      });
      toast.success("Sulama başlatıldı", point.name);
    } catch (error) {
      toast.error("Sulama başlatılamadı", (error as Error).message);
    } finally {
      setWatering(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={point.species?.name_tr ?? point.name}
        subtitle={`X ${Math.round(point.x)} · Y ${Math.round(point.y)} mm`}
        icon={<span className="text-lg">{point.species?.icon ?? "📍"}</span>}
      />

      <div className="space-y-4">
        <Input
          name="name"
          label="Etiket"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== point.name && onChange({ name })}
        />

        <Select
          name="stage"
          label="Aşama"
          value={point.stage}
          onChange={(e) => onChange({ stage: e.target.value as PlantStage })}
        >
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {/* Seçilen tarihteki durumu */}
        <div className="rounded-xl border border-brand/25 bg-brand/8 p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">
            {formatDate(viewDate)} tarihinde
          </p>
          <dl className="space-y-1.5 text-sm">
            <InfoRow label="Aşama" value={STAGE_LABELS[growth.stage]} />
            <InfoRow label="Yayılma çapı" value={`${Math.round(growth.radiusMm * 2)} mm`} />
            <InfoRow label="Olgunluk" value={`%${Math.round(growth.maturity * 100)}`} />
            {!growth.present && <InfoRow label="Durum" value="Henüz ekilmemiş" />}
          </dl>
        </div>

        {point.species && (
          <dl className="space-y-2 rounded-xl bg-surface-2 p-3.5 text-sm">
            <InfoRow label="Aralık" value={`${point.species.spread_mm} mm`} />
            <InfoRow label="Ekim derinliği" value={`${point.species.sow_depth_mm} mm`} />
            <InfoRow label="Hasat" value={`${point.species.days_to_harvest} gün`} />
            <InfoRow label="Günlük su" value={`${point.species.water_ml_per_day} ml`} />
            {point.planted_at && (
              <InfoRow label="Ekim tarihi" value={formatDate(point.planted_at)} />
            )}
          </dl>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            icon={<Droplets className="size-4" />}
            loading={watering}
            onClick={waterNow}
          >
            Sula
          </Button>
          <Button
            size="sm"
            icon={<Navigation className="size-4" />}
            onClick={async () => {
              if (!deviceId) return;
              try {
                await api.control.moveAbsolute(deviceId, { x: point.x, y: point.y, z: 0 });
                toast.success("Robot bitkiye gidiyor");
              } catch (error) {
                toast.error("Komut gönderilemedi", (error as Error).message);
              }
            }}
          >
            Git
          </Button>
        </div>

        <Button
          variant="danger"
          size="sm"
          fullWidth
          icon={<Trash2 className="size-4" />}
          onClick={onDelete}
        >
          Bitkiyi Kaldır
        </Button>
      </div>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-content">{value}</dd>
    </div>
  );
}
