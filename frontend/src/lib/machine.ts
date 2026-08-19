/**
 * Makine yapılandırması — eksen kalibrasyonu, uç değiştirme bölgesi, 3B görünüm.
 *
 * Sunucudaki `app/services/machine_config.py` ile aynı sözleşme. Değerler
 * `device.settings` JSON sütununda saklanıyor; buradaki yardımcılar eksik ya da
 * bozuk alanları güvenli varsayılanlara indirger, böylece arayüz hiçbir zaman
 * `undefined` bir ölçekle hesap yapmaz.
 */

export const AXES = ["x", "y", "z"] as const;
export type AxisName = (typeof AXES)[number];

export interface AxisConfig {
  /** counts/mm — makinenin bir milimetre için saydığı puls. null = makineninki. */
  cpm: number | null;
  /** Yön: +1 / -1. `null` = makinenin kendi yönü geçerli. */
  dir: 1 | -1 | null;
  /** Sıfır noktasının mm karşılığı. null = makineninki. */
  home_mm: number | null;
  /** Yumuşak sınırlar. null = makinenin kendi sınırı geçerli. */
  min_mm: number | null;
  max_mm: number | null;
  speed: number;
  accel: number;
}

export interface ToolSlot {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface ToolZoneConfig {
  enabled: boolean;
  safe_z: number;
  approach_mm: number;
  slots: ToolSlot[];
}

export interface ViewerConfig {
  /** Bakış köşesi — sıfır noktasının ekranda nerede kalacağını belirler. */
  camera_angle: string;
  robot_scale: number;
  zoom: number;
  font_scale: number;
  show_grid: boolean;
  show_labels: boolean;
}

export interface MachineConfig {
  axes: Record<AxisName, AxisConfig>;
  /** Yumuşak sınırlar uygulansın mı? Kapalıyken hiçbir hedef reddedilmez. */
  limits_enabled: boolean;
  tool_zone: ToolZoneConfig;
  viewer: ViewerConfig;
}

export const AXIS_DEFAULTS: AxisConfig = {
  // Boş alanlar "makineninkini kullan" demek; varsayılan bir sayı koymak
  // kalibre edilmemiş bir eksende yanlış davranış üretirdi.
  cpm: null,
  dir: null,
  home_mm: null,
  min_mm: null,
  max_mm: null,
  speed: 20,
  accel: 100,
};

export const TOOL_ZONE_DEFAULTS: ToolZoneConfig = {
  enabled: false,
  safe_z: 0,
  approach_mm: 40,
  slots: [],
};

export const VIEWER_DEFAULTS: ViewerConfig = {
  camera_angle: "on",
  robot_scale: 1,
  zoom: 1,
  font_scale: 1,
  show_grid: true,
  show_labels: true,
};

export const AXIS_LABELS: Record<AxisName, string> = {
  x: "X ekseni",
  y: "Y ekseni",
  z: "Z ekseni",
};

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

/** Boş bırakılabilen sayı: değer yoksa `null`. */
function optionalNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function readAxis(raw: unknown): AxisConfig {
  const source = (raw ?? {}) as Partial<Record<keyof AxisConfig, unknown>>;
  return {
    cpm: optionalNum(source.cpm),
    dir:
      source.dir === null || source.dir === undefined || source.dir === ""
        ? null
        : num(source.dir, 1) < 0
          ? -1
          : 1,
    home_mm: optionalNum(source.home_mm),
    min_mm: optionalNum(source.min_mm),
    max_mm: optionalNum(source.max_mm),
    speed: num(source.speed, AXIS_DEFAULTS.speed),
    accel: num(source.accel, AXIS_DEFAULTS.accel),
  };
}

/** `device.settings` içinden eksiksiz bir yapılandırma çıkarır. */
export function readMachineConfig(settings: Record<string, unknown> | undefined): MachineConfig {
  const source = (settings ?? {}) as Record<string, unknown>;
  const rawAxes = (source.axes ?? {}) as Record<string, unknown>;
  const rawZone = (source.tool_zone ?? {}) as Record<string, unknown>;
  const rawViewer = (source.viewer ?? {}) as Record<string, unknown>;

  return {
    limits_enabled: source.limits_enabled !== false,
    axes: {
      x: readAxis(rawAxes.x),
      y: readAxis(rawAxes.y),
      z: readAxis(rawAxes.z),
    },
    tool_zone: {
      enabled: Boolean(rawZone.enabled),
      safe_z: num(rawZone.safe_z, TOOL_ZONE_DEFAULTS.safe_z),
      approach_mm: num(rawZone.approach_mm, TOOL_ZONE_DEFAULTS.approach_mm),
      slots: Array.isArray(rawZone.slots)
        ? (rawZone.slots as unknown[]).flatMap((item) => {
            const slot = (item ?? {}) as Record<string, unknown>;
            const name = String(slot.name ?? "").trim();
            return name
              ? [{ name, x: num(slot.x, 0), y: num(slot.y, 0), z: num(slot.z, 0) }]
              : [];
          })
        : [],
    },
    viewer: {
      camera_angle:
        typeof rawViewer.camera_angle === "string" && rawViewer.camera_angle
          ? rawViewer.camera_angle
          : VIEWER_DEFAULTS.camera_angle,
      robot_scale: num(rawViewer.robot_scale, VIEWER_DEFAULTS.robot_scale),
      zoom: num(rawViewer.zoom, VIEWER_DEFAULTS.zoom),
      font_scale: num(rawViewer.font_scale, VIEWER_DEFAULTS.font_scale),
      show_grid: rawViewer.show_grid !== false,
      show_labels: rawViewer.show_labels !== false,
    },
  };
}

/**
 * Ölçüm sihirbazının hesabı — counts/mm bulur.
 *
 * Kullanıcı "Başlangıcı işaretle" der, ekseni sürer, cetvelle gerçek yolu ölçer.
 * Makine bu sırada `raw` count kadar saymıştır; counts/mm = sayılan / ölçülen.
 */
export function cpmFromMeasurement(
  countsMoved: number,
  measuredMm: number,
): number | null {
  if (!Number.isFinite(countsMoved) || !Number.isFinite(measuredMm)) return null;
  if (measuredMm === 0) return null;
  const cpm = Math.abs(countsMoved / measuredMm);
  return Number.isFinite(cpm) && cpm > 0 ? cpm : null;
}

/** Ham count değerini milimetreye çevirir (PLC_BRIEF.md §5). */
export function mmFromRaw(axis: AxisConfig, raw: number): number {
  const cpm = axis.cpm ?? 1;
  return ((axis.dir ?? 1) * raw) / (cpm || 1) + (axis.home_mm ?? 0);
}
