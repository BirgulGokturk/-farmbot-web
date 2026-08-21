/**
 * Etkileşimli tarla tuvali (2D).
 *
 * Tasarım kararı: viewBox yerine bir <g> üzerinde translate+scale kullanıyoruz.
 * Böylece ekran ↔ dünya (mm) dönüşümü tek satırlık bir formül oluyor.
 *
 * Etkileşimler:
 *   * Boş alanı sürükle           → görünümü kaydır
 *   * Shift + boş alanı sürükle   → kutu ile çoklu seçim
 *   * Bitkiye bas ve sürükle      → seçili tüm bitkileri birlikte taşı
 *   * Ctrl/Shift + tıkla          → seçime ekle / çıkar
 *   * Ctrl + tekerlek             → yakınlaştır (düz tekerlek sayfayı kaydırır)
 *   * Boş alana çift tıkla        → robotu oraya gönder
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { growthAt } from "@/lib/growth";
import type { Curve, Device, Point, Position, SpatialReading } from "@/lib/types";

const MIN_SCALE = 0.02;
const MAX_SCALE = 1.5;
/** Bu mesafeden az sürükleme tıklama sayılır — kazara taşımayı önler. */
const DRAG_THRESHOLD_PX = 4;

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface PointMove {
  id: string;
  x: number;
  y: number;
}

export interface GardenCanvasHandle {
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  hitTest: (clientX: number, clientY: number) => boolean;
}

interface GardenCanvasProps {
  device: Device;
  /** Ekilebilir dikdörtgen (mm). Verilmezse alan çizilmez. */
  ekimAlani?: { x1: number; y1: number; x2: number; y2: number } | null;
  points: Point[];
  botPosition: Position;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /** Sürükleme bittiğinde taşınan tüm noktalar tek seferde bildirilir. */
  onMovePoints: (moves: PointMove[], previous: PointMove[]) => void;
  onSendBot?: (x: number, y: number) => void;
  dropActive?: boolean;
  /** Zaman yolculuğu: bitkiler bu tarihteki boyutlarıyla çizilir. */
  viewDate: Date;
  curves: Map<string, Curve>;
  /** Isı haritası ölçümleri; null ise katman kapalı. */
  heatmap?: SpatialReading[] | null;
  /**
   * Renk ölçeğinin alt/üst sınırı — seçili sensörün kendi aralığı.
   * Farklı birimdeki sensörler (nem %, sıcaklık °C, ışık lux) tek ölçeğe
   * sokulursa renkler anlamsız çıkar; bu yüzden ölçek sensöre göre verilir.
   */
  heatRange?: { min: number; max: number };
}

export const GardenCanvas = forwardRef<GardenCanvasHandle, GardenCanvasProps>(
  function GardenCanvas(
    {
      device,
      ekimAlani,
      points,
      botPosition,
      selectedIds,
      onSelectionChange,
      onMovePoints,
      onSendBot,
      dropActive,
      viewDate,
      curves,
      heatmap,
      heatRange,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const [size, setSize] = useState({ width: 800, height: 500 });
    const [view, setView] = useState<View>({ scale: 0.1, offsetX: 40, offsetY: 40 });

    /** Sürüklenen noktaların geçici konumları (API'ye henüz yazılmadı). */
    const [drag, setDrag] = useState<{
      origin: { x: number; y: number };
      startPositions: Map<string, { x: number; y: number }>;
      current: Map<string, { x: number; y: number }>;
      moved: boolean;
    } | null>(null);

    /** Shift ile çizilen seçim kutusu (dünya koordinatı). */
    const [marquee, setMarquee] = useState<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    } | null>(null);

    const panRef = useRef<{
      startX: number;
      startY: number;
      offsetX: number;
      offsetY: number;
    } | null>(null);
    const [panning, setPanning] = useState(false);

    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    // --- Ölçüler --------------------------------------------------------- //

    useLayoutEffect(() => {
      const element = containerRef.current;
      if (!element) return;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        setSize({ width: Math.max(1, width), height: Math.max(1, height) });
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const fitToScreen = useCallback(() => {
      const padding = 50;
      const scale = Math.min(
        (size.width - padding * 2) / device.bed_width_mm,
        (size.height - padding * 2) / device.bed_length_mm,
      );
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      setView({
        scale: clamped,
        offsetX: (size.width - device.bed_width_mm * clamped) / 2,
        offsetY: (size.height - device.bed_length_mm * clamped) / 2,
      });
    }, [size.width, size.height, device.bed_width_mm, device.bed_length_mm]);

    const userAdjustedRef = useRef(false);
    useEffect(() => {
      if (!userAdjustedRef.current && size.width > 1) fitToScreen();
    }, [size.width, size.height, fitToScreen]);

    // --- Koordinat dönüşümü ---------------------------------------------- //

    const viewRef = useRef(view);
    viewRef.current = view;

    const screenToWorld = useCallback(
      (clientX: number, clientY: number) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        const current = viewRef.current;
        return {
          x: Math.round(
            Math.max(
              0,
              Math.min(device.bed_width_mm, (clientX - rect.left - current.offsetX) / current.scale),
            ),
          ),
          y: Math.round(
            Math.max(
              0,
              Math.min(
                device.bed_length_mm,
                (clientY - rect.top - current.offsetY) / current.scale,
              ),
            ),
          ),
        };
      },
      [device.bed_width_mm, device.bed_length_mm],
    );

    /** Kırpmasız dönüşüm — seçim kutusu yatak dışına taşabilmeli. */
    const rawWorld = useCallback((clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const current = viewRef.current;
      return {
        x: (clientX - rect.left - current.offsetX) / current.scale,
        y: (clientY - rect.top - current.offsetY) / current.scale,
      };
    }, []);

    const hitTest = useCallback((clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return false;
      return (
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      );
    }, []);

    useImperativeHandle(ref, () => ({ screenToWorld, hitTest }), [screenToWorld, hitTest]);

    // --- Yakınlaştırma ---------------------------------------------------- //

    const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
      userAdjustedRef.current = true;
      setView((current) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return { ...current, scale: next };

        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;
        const worldX = (screenX - current.offsetX) / current.scale;
        const worldY = (screenY - current.offsetY) / current.scale;

        return { scale: next, offsetX: screenX - worldX * next, offsetY: screenY - worldY * next };
      });
    }, []);

    useEffect(() => {
      const element = svgRef.current;
      if (!element) return;
      function onWheel(event: WheelEvent) {
        // Düz tekerlek sayfayı kaydırsın; tuval yalnızca Ctrl/⌘ ile yakınlaşsın
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
      }
      element.addEventListener("wheel", onWheel, { passive: false });
      return () => element.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    // --- Etkileşimi her zaman pencere düzeyinde bitir ---------------------- //

    // İşaretçi tuvalin dışında bırakılırsa pan/sürükleme durumu takılı kalmasın
    useEffect(() => {
      function finish() {
        if (panRef.current) {
          panRef.current = null;
          setPanning(false);
        }

        setMarquee((box) => {
          if (box) {
            const inside = points
              .filter((point) => {
                const x = Math.min(box.x1, box.x2);
                const y = Math.min(box.y1, box.y2);
                const w = Math.abs(box.x2 - box.x1);
                const h = Math.abs(box.y2 - box.y1);
                return (
                  point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
                );
              })
              .map((point) => point.id);
            onSelectionChange(inside);
          }
          return null;
        });

        setDrag((current) => {
          if (current?.moved) {
            const moves: PointMove[] = [];
            const previous: PointMove[] = [];
            for (const [id, position] of current.current) {
              const start = current.startPositions.get(id);
              if (!start) continue;
              moves.push({ id, x: position.x, y: position.y });
              previous.push({ id, x: start.x, y: start.y });
            }
            if (moves.length) onMovePoints(moves, previous);
          }
          return null;
        });
      }

      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      return () => {
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
    }, [points, onMovePoints, onSelectionChange]);

    // --- İşaretçi olayları -------------------------------------------------- //

    function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const target = (event.target as Element).closest("[data-point]");
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;

      if (target) {
        const id = target.getAttribute("data-point")!;
        // Seçili olmayan bir bitkiye basıldıysa seçim ona geçsin;
        // seçili bir bitkiye basıldıysa grup korunsun (grup taşıma için şart)
        let nextSelection = selectedIds;
        if (additive) {
          nextSelection = selected.has(id)
            ? selectedIds.filter((item) => item !== id)
            : [...selectedIds, id];
          onSelectionChange(nextSelection);
          return; // ekle/çıkar sırasında taşıma başlatma
        }
        if (!selected.has(id)) {
          nextSelection = [id];
          onSelectionChange(nextSelection);
        }

        const moving = new Map<string, { x: number; y: number }>();
        for (const point of points) {
          if (nextSelection.includes(point.id)) moving.set(point.id, { x: point.x, y: point.y });
        }
        setDrag({
          origin: { x: event.clientX, y: event.clientY },
          startPositions: moving,
          current: new Map(moving),
          moved: false,
        });
        return;
      }

      // Boş alan: Shift ile seçim kutusu, aksi halde kaydırma
      if (event.shiftKey) {
        const world = rawWorld(event.clientX, event.clientY);
        setMarquee({ x1: world.x, y1: world.y, x2: world.x, y2: world.y });
        return;
      }

      userAdjustedRef.current = true;
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      };
      setPanning(true);
      if (selectedIds.length) onSelectionChange([]);
    }

    function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
      if (drag) {
        const distance = Math.hypot(
          event.clientX - drag.origin.x,
          event.clientY - drag.origin.y,
        );
        if (!drag.moved && distance < DRAG_THRESHOLD_PX) return;

        const deltaX = (event.clientX - drag.origin.x) / view.scale;
        const deltaY = (event.clientY - drag.origin.y) / view.scale;

        const next = new Map<string, { x: number; y: number }>();
        for (const [id, start] of drag.startPositions) {
          next.set(id, {
            x: Math.round(Math.max(0, Math.min(device.bed_width_mm, start.x + deltaX))),
            y: Math.round(Math.max(0, Math.min(device.bed_length_mm, start.y + deltaY))),
          });
        }
        setDrag({ ...drag, current: next, moved: true });
        return;
      }

      if (marquee) {
        const world = rawWorld(event.clientX, event.clientY);
        setMarquee({ ...marquee, x2: world.x, y2: world.y });
        return;
      }

      const pan = panRef.current;
      if (!pan) return;
      setView((current) => ({
        ...current,
        offsetX: pan.offsetX + (event.clientX - pan.startX),
        offsetY: pan.offsetY + (event.clientY - pan.startY),
      }));
    }

    // --- Çizim ------------------------------------------------------------ //

    const gridStep = view.scale > 0.25 ? 100 : view.scale > 0.08 ? 500 : 1000;
    const verticalLines = countLines(device.bed_width_mm, gridStep);
    const horizontalLines = countLines(device.bed_length_mm, gridStep);

    /** Zaman yolculuğu: her bitkinin o tarihteki hali önceden hesaplanır. */
    const rendered = useMemo(
      () =>
        points.map((point) => ({
          point,
          growth: growthAt(point, viewDate, curves),
        })),
      [points, viewDate, curves],
    );

    return (
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface-2"
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          className={cn(
            "block touch-none select-none",
            panning
              ? "cursor-grabbing"
              : dropActive
                ? "cursor-copy"
                : marquee
                  ? "cursor-crosshair"
                  : "cursor-grab",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onDoubleClick={(event) => {
            if ((event.target as Element).closest("[data-point]")) return;
            const { x, y } = screenToWorld(event.clientX, event.clientY);
            onSendBot?.(x, y);
          }}
        >
          <defs>
            <linearGradient id="bed-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.09" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
            </linearGradient>
            {/* Isı haritası noktalarını birbirine karıştıran bulanıklık */}
            <filter id="heat-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation={220} />
            </filter>
          </defs>

          <g transform={`translate(${view.offsetX} ${view.offsetY}) scale(${view.scale})`}>
            <rect
              x="0"
              y="0"
              width={device.bed_width_mm}
              height={device.bed_length_mm}
              rx={40 / view.scale}
              fill="url(#bed-fill)"
              stroke="var(--border-strong)"
              strokeWidth={3 / view.scale}
            />

            {/*
              Ekilebilir alan.

              Yatağın kenarıyla toprağın başladığı yer aynı değil; arada
              profil ve kablo kanalı var. Dışarısını **soluklaştırıyoruz** ki
              nereye ekilebileceği bir bakışta görünsün — sayı olarak girilen
              ofsetin sahada neye denk geldiğini görmeden doğru ölçüldüğünden
              emin olunamıyor.
            */}
            {ekimAlani && (
              <g pointerEvents="none">
                {/* Alan dışını karart: dört kenar ayrı dikdörtgen */}
                {[
                  { x: 0, y: 0, w: device.bed_width_mm, h: ekimAlani.y1 },
                  {
                    x: 0,
                    y: ekimAlani.y2,
                    w: device.bed_width_mm,
                    h: device.bed_length_mm - ekimAlani.y2,
                  },
                  { x: 0, y: ekimAlani.y1, w: ekimAlani.x1, h: ekimAlani.y2 - ekimAlani.y1 },
                  {
                    x: ekimAlani.x2,
                    y: ekimAlani.y1,
                    w: device.bed_width_mm - ekimAlani.x2,
                    h: ekimAlani.y2 - ekimAlani.y1,
                  },
                ].map((k, i) =>
                  k.w > 0 && k.h > 0 ? (
                    <rect
                      key={i}
                      x={k.x}
                      y={k.y}
                      width={k.w}
                      height={k.h}
                      fill="var(--surface)"
                      fillOpacity="0.62"
                    />
                  ) : null,
                )}
                <rect
                  x={ekimAlani.x1}
                  y={ekimAlani.y1}
                  width={ekimAlani.x2 - ekimAlani.x1}
                  height={ekimAlani.y2 - ekimAlani.y1}
                  fill="none"
                  stroke="var(--warning)"
                  strokeOpacity="0.85"
                  strokeWidth={3 / view.scale}
                  strokeDasharray={`${14 / view.scale} ${10 / view.scale}`}
                />
              </g>
            )}

            {/* Isı haritası */}
            {heatmap && heatmap.length > 0 && (
              <g opacity="0.6" filter="url(#heat-blur)">
                {bucketReadings(heatmap).map((cell, index) => (
                  <circle
                    key={index}
                    cx={cell.x}
                    cy={cell.y}
                    // Ölçüm noktaları seyrek olduğu için lekeler geniş tutulur
                    r={700}
                    fill={heatColor(cell.value, heatRange)}
                  />
                ))}
              </g>
            )}

            <g stroke="var(--border)" strokeWidth={1 / view.scale} opacity="0.7">
              {verticalLines.map((x) => (
                <line key={`v${x}`} x1={x} y1={0} x2={x} y2={device.bed_length_mm} />
              ))}
              {horizontalLines.map((y) => (
                <line key={`h${y}`} x1={0} y1={y} x2={device.bed_width_mm} y2={y} />
              ))}
            </g>

            {/* Noktalar */}
            {rendered.map(({ point, growth }) => {
              const dragged = drag?.current.get(point.id);
              const x = dragged?.x ?? point.x;
              const y = dragged?.y ?? point.y;
              const color = point.species?.color ?? tintFor(point.point_type);
              const isSelected = selected.has(point.id);
              const radius = growth.radiusMm;

              return (
                <g
                  key={point.id}
                  data-point={point.id}
                  transform={`translate(${x} ${y})`}
                  className="cursor-move"
                  opacity={growth.present ? (dragged ? 0.8 : 1) : 0.25}
                >
                  <circle
                    r={radius}
                    fill={color}
                    fillOpacity={isSelected ? 0.32 : 0.18}
                    stroke={color}
                    strokeWidth={2 / view.scale}
                    strokeDasharray={
                      growth.stage === "planned" || !growth.present
                        ? `${8 / view.scale} ${6 / view.scale}`
                        : undefined
                    }
                  />
                  {isSelected && (
                    <circle
                      r={radius + 18 / view.scale}
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth={3 / view.scale}
                    />
                  )}
                  {/*
                    Merkez rozeti bitkinin aşamasını gösteriyor: tohum evresinde
                    sade nokta, filizlenince 🌱, olgunlaşınca türün kendi emojisi.
                    Emoji seçmemizin sebebi tür başına çizim gerektirmemesi —
                    kataloğa yeni bir sebze eklendiğinde kendiliğinden doğru
                    görünüyor.
                  */}
                  {point.species && growth.present && growth.maturity >= 0.15 ? (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.max(22, radius * 0.9)}
                      className="pointer-events-none select-none"
                    >
                      {growth.maturity >= 0.55 ? point.species.icon : "🌱"}
                    </text>
                  ) : (
                    <circle r={Math.max(10, 9 / view.scale)} fill={color} />
                  )}
                  {view.scale > 0.12 && (
                    <text
                      y={radius + 34 / view.scale}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize={13 / view.scale}
                      className="pointer-events-none"
                    >
                      {point.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Seçim kutusu */}
            {marquee && (
              <rect
                x={Math.min(marquee.x1, marquee.x2)}
                y={Math.min(marquee.y1, marquee.y2)}
                width={Math.abs(marquee.x2 - marquee.x1)}
                height={Math.abs(marquee.y2 - marquee.y1)}
                fill="var(--brand)"
                fillOpacity="0.12"
                stroke="var(--brand)"
                strokeWidth={2 / view.scale}
                strokeDasharray={`${10 / view.scale} ${6 / view.scale}`}
                className="pointer-events-none"
              />
            )}

            {/* Robotun anlık konumu */}
            <g className="pointer-events-none">
              <line
                x1={botPosition.x}
                y1={-40 / view.scale}
                x2={botPosition.x}
                y2={device.bed_length_mm + 40 / view.scale}
                stroke="var(--brand)"
                strokeWidth={3 / view.scale}
                strokeOpacity="0.5"
              />
              <line
                x1={-40 / view.scale}
                y1={botPosition.y}
                x2={device.bed_width_mm + 40 / view.scale}
                y2={botPosition.y}
                stroke="var(--brand)"
                strokeWidth={3 / view.scale}
                strokeOpacity="0.25"
              />
              <circle
                cx={botPosition.x}
                cy={botPosition.y}
                r={30 / view.scale}
                fill="var(--brand)"
                fillOpacity="0.2"
              />
              <circle
                cx={botPosition.x}
                cy={botPosition.y}
                r={14 / view.scale}
                fill="var(--brand)"
                stroke="var(--surface)"
                strokeWidth={4 / view.scale}
              />
            </g>
          </g>
        </svg>

        <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
          <CanvasButton
            label="Yakınlaştır"
            onClick={() => {
              const c = centerOf(svgRef);
              zoomAt(c.x, c.y, 1.25);
            }}
          >
            <Plus className="size-4" />
          </CanvasButton>
          <CanvasButton
            label="Uzaklaştır"
            onClick={() => {
              const c = centerOf(svgRef);
              zoomAt(c.x, c.y, 1 / 1.25);
            }}
          >
            <Minus className="size-4" />
          </CanvasButton>
          <CanvasButton
            label="Ekrana sığdır"
            onClick={() => {
              userAdjustedRef.current = false;
              fitToScreen();
            }}
          >
            <Maximize2 className="size-4" />
          </CanvasButton>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-lg glass px-2.5 py-1.5 text-xs text-muted">
          <Crosshair className="size-3.5" />
          <span className="font-mono">{Math.round(view.scale * 1000) / 10}×</span>
          <span className="text-subtle">· ızgara {gridStep} mm</span>
          {selectedIds.length > 1 && (
            <span className="text-brand">· {selectedIds.length} seçili</span>
          )}
        </div>
      </div>
    );
  },
);

// --------------------------------------------------------------------------- //
// Yardımcılar
// --------------------------------------------------------------------------- //

function CanvasButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-lg glass border border-line text-muted
                 transition-soft hover:text-brand active:scale-95"
    >
      {children}
    </button>
  );
}

function countLines(total: number, step: number): number[] {
  const lines: number[] = [];
  for (let value = step; value < total; value += step) lines.push(value);
  return lines;
}

function tintFor(type: Point["point_type"]): string {
  switch (type) {
    case "weed":
      return "#f59e0b";
    case "tool_slot":
      return "#64748b";
    default:
      return "#38bdf8";
  }
}

function centerOf(ref: React.RefObject<SVGSVGElement | null>) {
  const rect = ref.current?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Ölçümleri ızgara hücrelerine toplar.
 * Yüzlerce daireyi tek tek çizmek yerine hücre ortalaması almak hem
 * performansı korur hem de haritayı okunur kılar.
 */
function bucketReadings(readings: SpatialReading[], cellSize = 400) {
  const cells = new Map<string, { x: number; y: number; total: number; count: number }>();

  for (const reading of readings) {
    const cellX = Math.floor(reading.x / cellSize);
    const cellY = Math.floor(reading.y / cellSize);
    const key = `${cellX}:${cellY}`;
    const cell = cells.get(key) ?? {
      x: cellX * cellSize + cellSize / 2,
      y: cellY * cellSize + cellSize / 2,
      total: 0,
      count: 0,
    };
    cell.total += reading.value;
    cell.count += 1;
    cells.set(key, cell);
  }

  return [...cells.values()].map((cell) => ({
    x: cell.x,
    y: cell.y,
    value: cell.total / cell.count,
  }));
}

/**
 * Düşük değer → sıcak kırmızı, yüksek değer → serin mavi.
 * Ölçek seçili sensörün kendi aralığına göre normalize edilir; aksi halde
 * lux ile °C aynı renk skalasına düşer ve harita anlamsızlaşır.
 */
function heatColor(value: number, range?: { min: number; max: number }): string {
  const min = range?.min ?? 0;
  const max = range?.max ?? 100;
  const span = max - min || 1;
  const t = Math.max(0, Math.min(1, (value - min) / span));
  const hue = 8 + t * 200; // 8° kırmızı → 208° mavi
  return `hsl(${hue} 85% 55%)`;
}
