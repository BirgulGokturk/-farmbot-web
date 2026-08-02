import type { Device, Point, Position } from "@/lib/types";

/**
 * Bahçenin salt-okunur kuşbakışı özeti.
 * Tam etkileşimli sürükle-bırak sürümü Tarla Tasarımcısı'nda.
 */
export function GardenMiniMap({
  device,
  points,
  position,
}: {
  device: Device;
  points: Point[];
  position: Position;
}) {
  const width = device.bed_width_mm;
  const height = device.bed_length_mm;

  // 1 metrelik ızgara çizgileri
  const verticalLines = Array.from({ length: Math.floor(width / 1000) }, (_, i) => (i + 1) * 1000);
  const horizontalLines = Array.from({ length: Math.floor(height / 1000) }, (_, i) => (i + 1) * 1000);

  const plants = points.filter((p) => p.point_type === "plant" && p.species);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <svg
        viewBox={`-40 -40 ${width + 80} ${height + 80}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Bahçe kuşbakışı görünümü"
      >
        <defs>
          <linearGradient id="bedFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Yatak zemini */}
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="24"
          fill="url(#bedFill)"
          stroke="var(--border-strong)"
          strokeWidth="4"
        />

        {/* Metrelik ızgara */}
        {verticalLines.map((x) => (
          <line
            key={`v${x}`}
            x1={x}
            y1={0}
            x2={x}
            y2={height}
            stroke="var(--border)"
            strokeWidth="2"
            strokeDasharray="12 16"
          />
        ))}
        {horizontalLines.map((y) => (
          <line
            key={`h${y}`}
            x1={0}
            y1={y}
            x2={width}
            y2={y}
            stroke="var(--border)"
            strokeWidth="2"
            strokeDasharray="12 16"
          />
        ))}

        {/* Bitkiler */}
        {plants.map((plant) => (
          <g key={plant.id}>
            <circle
              cx={plant.x}
              cy={plant.y}
              r={plant.radius_mm}
              fill={plant.species!.color}
              fillOpacity="0.22"
              stroke={plant.species!.color}
              strokeWidth="3"
            />
            <circle cx={plant.x} cy={plant.y} r="14" fill={plant.species!.color} />
          </g>
        ))}

        {/* Gantry (X ekseni konumu) */}
        <line
          x1={position.x}
          y1={-30}
          x2={position.x}
          y2={height + 30}
          stroke="var(--brand)"
          strokeWidth="5"
          strokeOpacity="0.55"
        />
        {/* Çapraz kızak (Y ekseni konumu) */}
        <line
          x1={-30}
          y1={position.y}
          x2={width + 30}
          y2={position.y}
          stroke="var(--brand)"
          strokeWidth="5"
          strokeOpacity="0.28"
        />

        {/* Alet başlığı */}
        <g>
          <circle cx={position.x} cy={position.y} r="44" fill="var(--brand)" fillOpacity="0.18" />
          <circle
            cx={position.x}
            cy={position.y}
            r="22"
            fill="var(--brand)"
            stroke="var(--surface)"
            strokeWidth="6"
          />
        </g>

        {/* Başlangıç noktası (0,0) işareti */}
        <circle cx="0" cy="0" r="12" fill="none" stroke="var(--text-subtle)" strokeWidth="3" />
      </svg>
    </div>
  );
}
