import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Leaf, Map, Search, Sprout, Trash2, Navigation } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { GardenCanvas, type GardenCanvasHandle } from "@/components/designer/GardenCanvas";
import { usePaletteDrag } from "@/components/designer/usePaletteDrag";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBotPosition } from "@/store/useBot";
import type { PlantSpecies, PlantStage, Point } from "@/lib/types";

const STAGE_LABELS: Record<PlantStage, string> = {
  planned: "Planlandı",
  planted: "Ekildi",
  sprouted: "Filizlendi",
  active: "Büyüyor",
  harvested: "Hasat edildi",
  removed: "Kaldırıldı",
};

export default function Designer() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const queryClient = useQueryClient();
  const botPosition = useBotPosition();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const canvasRef = useRef<GardenCanvasHandle>(null);

  const { data: points, isLoading } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const { data: species } = useQuery({
    queryKey: ["species"],
    queryFn: () => api.catalog.species(),
  });

  const selected = points?.find((p) => p.id === selectedId) ?? null;

  // --- Değişiklikler ------------------------------------------------------- //

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
    onSuccess: (point) => {
      void queryClient.invalidateQueries({ queryKey: ["points", deviceId] });
      setSelectedId(point.id);
      toast.success(`${point.name} eklendi`, `X ${Math.round(point.x)} · Y ${Math.round(point.y)}`);
    },
    onError: (error) => toast.error("Bitki eklenemedi", (error as Error).message),
  });

  const movePoint = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) =>
      api.points.update(deviceId!, id, { x, y }),
    // İyimser güncelleme: sürükleme bittiğinde bitki geri zıplamasın
    onMutate: async ({ id, x, y }) => {
      await queryClient.cancelQueries({ queryKey: ["points", deviceId] });
      const previous = queryClient.getQueryData<Point[]>(["points", deviceId]);
      queryClient.setQueryData<Point[]>(["points", deviceId], (old) =>
        old?.map((p) => (p.id === id ? { ...p, x, y } : p)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(["points", deviceId], context?.previous);
      toast.error("Taşıma kaydedilemedi", (error as Error).message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["points", deviceId] }),
  });

  const updatePoint = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.points.update>[2] }) =>
      api.points.update(deviceId!, id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["points", deviceId] }),
    onError: (error) => toast.error("Güncellenemedi", (error as Error).message),
  });

  const deletePoint = useMutation({
    mutationFn: (id: string) => api.points.remove(deviceId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["points", deviceId] });
      setSelectedId(null);
      toast.success("Bitki kaldırıldı");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  // Paletten sürükleme: bırakma anında ekran koordinatı tuval üzerinden mm'ye çevrilir
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tarla Tasarımcısı"
        description="Bitkileri paletten sürükleyip bahçeye bırakın"
        icon={<Map className="size-5" />}
        actions={
          <>
            <Badge tone="brand">{plantCount} bitki</Badge>
            {device && (
              <Badge>
                {(device.bed_width_mm / 1000).toFixed(1)} × {(device.bed_length_mm / 1000).toFixed(1)} m
              </Badge>
            )}
          </>
        }
      />

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
              <p className="col-span-full py-6 text-center text-sm text-subtle">
                Eşleşen bitki yok
              </p>
            )}
          </div>
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-subtle">
            Bir bitkiye basılı tutup bahçeye sürükleyin. Yerleştirdikten sonra taşımak için
            üzerine basılı tutup kaydırın.
          </p>
        </Card>

        {/* Tuval */}
        <div className="order-1 h-[62vh] min-h-[420px] xl:order-2 xl:h-[calc(100vh-16rem)]">
          {isLoading || !device ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <GardenCanvas
              ref={canvasRef}
              device={device}
              points={points ?? []}
              botPosition={botPosition}
              selectedId={selectedId}
              onSelect={setSelectedId}
              dropActive={paletteDrag.dragging}
              onMovePoint={(id, x, y) => movePoint.mutate({ id, x, y })}
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

        {/* Seçili bitki */}
        <div className="order-3">
          {selected ? (
            <PointInspector
              point={selected}
              onChange={(patch) => updatePoint.mutate({ id: selected.id, patch })}
              onDelete={() => deletePoint.mutate(selected.id)}
              deleting={deletePoint.isPending}
            />
          ) : (
            <Card>
              <CardHeader title="Seçim" icon={<Sprout className="size-4" />} />
              <p className="py-6 text-center text-sm text-subtle">
                Ayrıntıları görmek için bahçeden bir bitki seçin.
              </p>
              <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
                <p>
                  <strong className="text-muted">Kaydır:</strong> boş alanı sürükleyin
                </p>
                <p>
                  <strong className="text-muted">Yakınlaştır:</strong> Ctrl + fare tekerleği veya sağ
                  alttaki düğmeler
                </p>
                <p>
                  <strong className="text-muted">Robotu gönder:</strong> boş alana çift tıklayın
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Paletten sürüklenen bitkinin imleci takip eden hayaleti */}
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

function PointInspector({
  point,
  onChange,
  onDelete,
  deleting,
}: {
  point: Point;
  onChange: (patch: { name?: string; stage?: PlantStage; x?: number; y?: number }) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const deviceId = useDeviceId();
  const [name, setName] = useState(point.name);
  const [watering, setWatering] = useState(false);

  // Başka bir bitki seçilince form yeni değere dönsün
  useEffect(() => setName(point.name), [point.id, point.name]);

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
          loading={deleting}
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
