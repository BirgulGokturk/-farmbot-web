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
  /** Komut edilen 1 mm karşılığında makineye yazılan birim. */
  scale: number;
  /** Sıfır noktası kaydırması (makine birimi) — X ofseti bu alan. */
  offset: number;
  /** Yön ters mi. */
  invert: boolean;
  min_mm: number;
  max_mm: number;
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
  robot_scale: number;
  zoom: number;
  font_scale: number;
  show_grid: boolean;
  show_labels: boolean;
}

export interface MachineConfig {
  axes: Record<AxisName, AxisConfig>;
  tool_zone: ToolZoneConfig;
  viewer: ViewerConfig;
}

export const AXIS_DEFAULTS: AxisConfig = {
  scale: 1,
  offset: 0,
  invert: false,
  min_mm: 0,
  max_mm: 1000,
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

function readAxis(raw: unknown): AxisConfig {
  const source = (raw ?? {}) as Partial<Record<keyof AxisConfig, unknown>>;
  const scale = num(source.scale, AXIS_DEFAULTS.scale);
  return {
    // Ölçek sıfır olursa her hareket sıfır birime çevrilir ve eksen kilitlenir
    scale: scale === 0 ? AXIS_DEFAULTS.scale : scale,
    offset: num(source.offset, AXIS_DEFAULTS.offset),
    invert: Boolean(source.invert),
    min_mm: num(source.min_mm, AXIS_DEFAULTS.min_mm),
    max_mm: num(source.max_mm, AXIS_DEFAULTS.max_mm),
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
      robot_scale: num(rawViewer.robot_scale, VIEWER_DEFAULTS.robot_scale),
      zoom: num(rawViewer.zoom, VIEWER_DEFAULTS.zoom),
      font_scale: num(rawViewer.font_scale, VIEWER_DEFAULTS.font_scale),
      show_grid: rawViewer.show_grid !== false,
      show_labels: rawViewer.show_labels !== false,
    },
  };
}

/**
 * Ölçüm sihirbazının hesabı.
 *
 * Kullanıcı "100 mm git" der, cetvelle 700 mm ölçer. Demek ki makine, komut
 * edilen her birim için 7 birim yol alıyor; komutu 7'ye bölerek göndermeliyiz.
 * Yeni ölçek = eski ölçek × (komut edilen / ölçülen).
 */
export function scaleFromMeasurement(
  currentScale: number,
  commandedMm: number,
  measuredMm: number,
): number | null {
  if (!Number.isFinite(commandedMm) || !Number.isFinite(measuredMm)) return null;
  if (commandedMm === 0 || measuredMm === 0) return null;
  const next = currentScale * (commandedMm / measuredMm);
  return Number.isFinite(next) && next !== 0 ? next : null;
}

/** Kullanıcı milimetresini makine birimine çevirir (önizleme için). */
export function toMachine(axis: AxisConfig, userMm: number): number {
  return axis.offset + (axis.invert ? -1 : 1) * axis.scale * userMm;
}
