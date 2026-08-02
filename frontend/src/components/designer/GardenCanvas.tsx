/**
 * Etkileşimli tarla tuvali.
 *
 * Tasarım kararı: viewBox yerine bir <g> üzerinde translate+scale kullanıyoruz.
 * Böylece ekran ↔ dünya (mm) dönüşümü tek satırlık bir formül oluyor ve
 * viewBox'ın "letterbox" davranışıyla uğraşmak gerekmiyor.
 *
 * Sürükleme pointer olaylarıyla yazıldı; fare ve dokunmatik aynı kodu kullanır.
 * Paletten bırakma işini üst bileşen yönetir; tuval yalnızca koordinat
 * dönüşümünü ve isabet testini `ref` üzerinden dışa açar.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Device, Point, Position } from "@/lib/types";

const MIN_SCALE = 0.02;
const MAX_SCALE = 1.5;

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Üst bileşenin tuvale imperatif erişimi. */
export interface GardenCanvasHandle {
  /** Ekran koordinatını yatak koordinatına (mm) çevirir ve yatağa kırpar. */
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Verilen ekran noktası tuvalin üzerinde mi? */
  hitTest: (clientX: number, clientY: number) => boolean;
}

interface GardenCanvasProps {
  device: Device;
  points: Point[];
  botPosition: Position;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Var olan bitki taşındı (sürükleme bittiğinde bir kez çağrılır). */
  onMovePoint: (id: string, x: number, y: number) => void;
  /** Boş alana çift tıklandığında robotu oraya gönder. */
  onSendBot?: (x: number, y: number) => void;
  /** Paletten sürükleme sürüyorsa imleç görsel olarak değişsin. */
  dropActive?: boolean;
}

export const GardenCanvas = forwardRef<GardenCanvasHandle, GardenCanvasProps>(
  function GardenCanvas(
    { device, points, botPosition, selectedId, onSelect, onMovePoint, onSendBot, dropActive },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const [size, setSize] = useState({ width: 800, height: 500 });
    const [view, setView] = useState<View>({ scale: 0.1, offsetX: 40, offsetY: 40 });

    /** Sürüklenen noktanın geçici konumu (API'ye henüz yazılmadı). */
    const [dragging, setDragging] = useState<{
      id: string;
      x: number;
      y: number;
      moved: boolean;
    } | null>(null);

    const panRef = useRef<{
      startX: number;
      startY: number;
      offsetX: number;
      offsetY: number;
    } | null>(null);
    const [panning, setPanning] = useState(false);

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

    /**
     * Kullanıcı görünümü elle değiştirmediyse, kap her yeniden boyutlandığında
     * bahçeyi otomatik sığdır. Tek seferlik sığdırma, yerleşim ilk render'da
     * oturmadığı için yanlış ölçekte kalabiliyordu.
     */
    const userAdjustedRef = useRef(false);
    useEffect(() => {
      if (!userAdjustedRef.current && size.width > 1) fitToScreen();
    }, [size.width, size.height, fitToScreen]);

    // --- Koordinat dönüşümü ---------------------------------------------- //

    // View'i ref'te de tutuyoruz: imperatif API her zaman güncel değeri görsün.
    const viewRef = useRef(view);
    viewRef.current = view;

    const screenToWorld = useCallback(
      (clientX: number, clientY: number) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        const current = viewRef.current;
        const x = (clientX - rect.left - current.offsetX) / current.scale;
        const y = (clientY - rect.top - current.offsetY) / current.scale;
        return {
          x: Math.round(Math.max(0, Math.min(device.bed_width_mm, x))),
          y: Math.round(Math.max(0, Math.min(device.bed_length_mm, y))),
        };
      },
      [device.bed_width_mm, device.bed_length_mm],
    );

    const hitTest = useCallback((clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return false;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
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

        // İmlecin altındaki dünya noktası sabit kalsın
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;
        const worldX = (screenX - current.offsetX) / current.scale;
        const worldY = (screenY - current.offsetY) / current.scale;

        return { scale: next, offsetX: screenX - worldX * next, offsetY: screenY - worldY * next };
      });
    }, []);

    /**
     * Tuval sayfanın içine gömülü olduğu için düz tekerlek hareketini YUTMUYORUZ —
     * yoksa kullanıcı tuvalin üzerindeyken sayfayı kaydıramaz, kazara yakınlaşır.
     * Yakınlaştırma: Ctrl/⌘ + tekerlek ya da sağ alttaki düğmeler.
     * preventDefault çağırabilmek için dinleyici passive olmamalı.
     */
    useEffect(() => {
      const element = svgRef.current;
      if (!element) return;

      function onWheel(event: WheelEvent) {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
      }

      element.addEventListener("wheel", onWheel, { passive: false });
      return () => element.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    // --- Sürükleme ve kaydırma -------------------------------------------- //

    // Etkileşimi her zaman pencere düzeyinde bitiriyoruz. Aksi halde işaretçi
    // tuvalin dışında bırakılırsa pan durumu takılı kalır ve sonraki her
    // fare hareketi görüntüyü kaydırır.
    useEffect(() => {
      function finish() {
        if (panRef.current) {
          panRef.current = null;
          setPanning(false);
        }
        setDragging((current) => {
          if (current?.moved) onMovePoint(current.id, current.x, current.y);
          return null;
        });
      }

      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      return () => {
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
    }, [onMovePoint]);

    function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
      // Sadece birincil düğme kaydırsın (sağ tık menüsü bozulmasın)
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const pointTarget = (event.target as Element).closest("[data-point]");
      if (pointTarget) {
        const id = pointTarget.getAttribute("data-point");
        const point = points.find((p) => p.id === id);
        if (point) {
          onSelect(point.id);
          setDragging({ id: point.id, x: point.x, y: point.y, moved: false });
          return;
        }
      }

      userAdjustedRef.current = true;
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      };
      setPanning(true);
      onSelect(null);
    }

    function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
      if (dragging) {
        const { x, y } = screenToWorld(event.clientX, event.clientY);
        setDragging((current) => (current ? { ...current, x, y, moved: true } : null));
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
            panning ? "cursor-grabbing" : dropActive ? "cursor-copy" : "cursor-grab",
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
          </defs>

          <g transform={`translate(${view.offsetX} ${view.offsetY}) scale(${view.scale})`}>
            {/* Yatak */}
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

            {/* Izgara */}
            <g stroke="var(--border)" strokeWidth={1 / view.scale} opacity="0.7">
              {verticalLines.map((x) => (
                <line key={`v${x}`} x1={x} y1={0} x2={x} y2={device.bed_length_mm} />
              ))}
              {horizontalLines.map((y) => (
                <line key={`h${y}`} x1={0} y1={y} x2={device.bed_width_mm} y2={y} />
              ))}
            </g>

            {/* Noktalar */}
            {points.map((point) => {
              const isDragging = dragging?.id === point.id;
              const x = isDragging ? dragging.x : point.x;
              const y = isDragging ? dragging.y : point.y;
              const color = point.species?.color ?? tintFor(point.point_type);
              const selected = selectedId === point.id;

              return (
                <g
                  key={point.id}
                  data-point={point.id}
                  transform={`translate(${x} ${y})`}
                  className={cn("cursor-move", isDragging && "opacity-80")}
                >
                  {/* Yayılma alanı */}
                  <circle
                    r={point.radius_mm}
                    fill={color}
                    fillOpacity={selected ? 0.32 : 0.18}
                    stroke={color}
                    strokeWidth={2 / view.scale}
                    strokeDasharray={
                      point.stage === "planned" ? `${8 / view.scale} ${6 / view.scale}` : undefined
                    }
                  />
                  {selected && (
                    <circle
                      r={point.radius_mm + 18 / view.scale}
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth={3 / view.scale}
                    />
                  )}
                  <circle r={Math.max(10, 9 / view.scale)} fill={color} />
                  {view.scale > 0.12 && (
                    <text
                      y={point.radius_mm + 34 / view.scale}
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

        {/* Yakınlaştırma araçları */}
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

        {/* Ölçek göstergesi */}
        <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-lg glass px-2.5 py-1.5 text-xs text-muted">
          <Crosshair className="size-3.5" />
          <span className="font-mono">{Math.round(view.scale * 1000) / 10}×</span>
          <span className="text-subtle">· ızgara {gridStep} mm</span>
        </div>
      </div>
    );
  },
);

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
