/**
 * Sürüklenebilir noktalı büyüme eğrisi editörü.
 *
 * Eğri `{gün: değer}` biçiminde saklanır. Kullanıcı noktaları sürükleyerek
 * bitkinin yaşına göre su ihtiyacını, yayılmasını veya boyunu şekillendirir.
 * Zaman yolculuğu ve 3D görünüm bu eğrilerden besleniyor.
 */

import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { sampleCurve } from "@/lib/growth";
import type { CurveType } from "@/lib/types";

const PADDING = { top: 16, right: 16, bottom: 30, left: 46 };
const VIEW = { width: 640, height: 240 };

export const CURVE_META: Record<
  CurveType,
  { label: string; unit: string; maxValue: number; color: string }
> = {
  water: { label: "Su", unit: "ml/gün", maxValue: 2000, color: "#38bdf8" },
  spread: { label: "Yayılma", unit: "mm", maxValue: 1200, color: "#34d399" },
  height: { label: "Boy", unit: "mm", maxValue: 2000, color: "#fbbf24" },
};

interface CurveEditorProps {
  type: CurveType;
  data: Record<string, number>;
  /** Sürükleme bittiğinde ya da nokta eklenip silindiğinde çağrılır. */
  onChange: (next: Record<string, number>) => void;
  /** Eğrinin kapsadığı gün sayısı (x ekseni sonu) */
  maxDay?: number;
  readOnly?: boolean;
}

export function CurveEditor({
  type,
  data,
  onChange,
  maxDay = 120,
  readOnly = false,
}: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const meta = CURVE_META[type];
  const [dragging, setDragging] = useState<number | null>(null);

  /** Noktalar her zaman güne göre sıralı tutulur. */
  const points = useMemo(
    () =>
      Object.entries(data)
        .map(([day, value]) => ({ day: Number(day), value: Number(value) }))
        .filter((p) => Number.isFinite(p.day) && Number.isFinite(p.value))
        .sort((a, b) => a.day - b.day),
    [data],
  );

  const plotWidth = VIEW.width - PADDING.left - PADDING.right;
  const plotHeight = VIEW.height - PADDING.top - PADDING.bottom;

  const toScreen = useCallback(
    (day: number, value: number) => ({
      x: PADDING.left + (day / maxDay) * plotWidth,
      y: PADDING.top + plotHeight - (value / meta.maxValue) * plotHeight,
    }),
    [maxDay, meta.maxValue, plotWidth, plotHeight],
  );

  const toData = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { day: 0, value: 0 };

      // SVG ölçeklendiği için ekran pikselini viewBox birimine çevir
      const scaleX = VIEW.width / rect.width;
      const scaleY = VIEW.height / rect.height;
      const localX = (clientX - rect.left) * scaleX - PADDING.left;
      const localY = (clientY - rect.top) * scaleY - PADDING.top;

      return {
        day: Math.round(Math.max(0, Math.min(maxDay, (localX / plotWidth) * maxDay))),
        value: Math.round(
          Math.max(0, Math.min(meta.maxValue, (1 - localY / plotHeight) * meta.maxValue)),
        ),
      };
    },
    [maxDay, meta.maxValue, plotWidth, plotHeight],
  );

  function commit(next: { day: number; value: number }[]) {
    const record: Record<string, number> = {};
    for (const point of next) record[String(point.day)] = point.value;
    onChange(record);
  }

  function handlePointerDown(event: ReactPointerEvent<SVGCircleElement>, index: number) {
    if (readOnly) return;
    event.stopPropagation();
    setDragging(index);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragging === null || readOnly) return;

    const { day, value } = toData(event.clientX, event.clientY);
    const next = [...points];
    // Komşu noktaların arasından çıkmasın — eğri hep soldan sağa artan kalsın
    const lower = dragging > 0 ? next[dragging - 1].day + 1 : 0;
    const upper = dragging < next.length - 1 ? next[dragging + 1].day - 1 : maxDay;

    next[dragging] = { day: Math.max(lower, Math.min(upper, day)), value };
    commit(next);
  }

  function handlePointerUp() {
    setDragging(null);
  }

  function addPoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (readOnly || dragging !== null) return;
    const { day, value } = toData(event.clientX, event.clientY);
    if (points.some((p) => p.day === day)) return;
    commit([...points, { day, value }].sort((a, b) => a.day - b.day));
  }

  function removePoint(index: number) {
    if (readOnly || points.length <= 2) return; // en az iki nokta kalsın
    commit(points.filter((_, i) => i !== index));
  }

  // --- Çizim yolu ---
  const linePath = points
    .map((point, index) => {
      const { x, y } = toScreen(point.day, point.value);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPath = points.length
    ? `${linePath} L ${toScreen(points[points.length - 1].day, 0).x.toFixed(1)} ${(
        PADDING.top + plotHeight
      ).toFixed(1)} L ${toScreen(points[0].day, 0).x.toFixed(1)} ${(
        PADDING.top + plotHeight
      ).toFixed(1)} Z`
    : "";

  const gradientId = `curve-${type}`;

  return (
    <div className="space-y-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className={cn(
          "w-full touch-none select-none rounded-xl border border-line bg-surface-2",
          !readOnly && "cursor-crosshair",
        )}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={addPoint}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={meta.color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={meta.color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Yatay ızgara ve değer etiketleri */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PADDING.top + plotHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={VIEW.width - PADDING.right}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 6"
              />
              <text
                x={PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-subtle)"
              >
                {Math.round(meta.maxValue * ratio)}
              </text>
            </g>
          );
        })}

        {/* Gün etiketleri */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const x = PADDING.left + plotWidth * ratio;
          return (
            <text
              key={ratio}
              x={x}
              y={VIEW.height - 10}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-subtle)"
            >
              {Math.round(maxDay * ratio)} g
            </text>
          );
        })}

        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {linePath && (
          <path d={linePath} fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinejoin="round" />
        )}

        {/* Sürüklenebilir noktalar */}
        {points.map((point, index) => {
          const { x, y } = toScreen(point.day, point.value);
          const active = dragging === index;
          return (
            <g key={`${point.day}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r={active ? 9 : 6}
                fill={meta.color}
                stroke="var(--surface)"
                strokeWidth="2.5"
                className={readOnly ? "" : "cursor-grab active:cursor-grabbing"}
                onPointerDown={(event) => handlePointerDown(event, index)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  removePoint(index);
                }}
              />
              {active && (
                <text
                  x={x}
                  y={y - 16}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="600"
                  fill="var(--text)"
                >
                  {point.day}g · {point.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {!readOnly && (
        <p className="flex items-center gap-3 text-xs text-subtle">
          <span className="flex items-center gap-1">
            <Plus className="size-3" /> Eklemek için boş alana çift tıkla
          </span>
          <span className="flex items-center gap-1">
            <Trash2 className="size-3" /> Silmek için noktaya çift tıkla
          </span>
          <span className="ml-auto font-mono">
            {points.length} nokta · {meta.unit}
          </span>
        </p>
      )}
    </div>
  );
}

/** Bir eğrinin belirli gündeki değerini metin olarak döndürür (özet gösterimi). */
export function curveSummary(data: Record<string, number>, day: number): string {
  const value = sampleCurve(data, day);
  return value === null ? "—" : String(Math.round(value));
}
