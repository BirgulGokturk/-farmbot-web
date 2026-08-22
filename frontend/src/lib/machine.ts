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
  /** Hız tavanı (mm/s). `null` = makinenin kendi değeri geçerli. */
  speed: number | null;
  accel: number | null;
}

export interface ToolSlot {
  name: string;
  x: number;
  y: number;
  z: number;
}

/** Yasaklı kutu — hedefi içine düşen hareket, koşul doğru değilse engellenir. */
export interface RestrictedZone {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Serbest ifade; burada çalıştırılmıyor, yalnızca saklanıyor. */
  allow_if: string;
}

/** İçinde Z güvenlik kilidinin devre dışı kaldığı dörtgen. */
export interface ChangeArea {
  enabled: boolean;
  corners: [number, number][];
}

/**
 * Uç değiştirme ayarları.
 *
 * Alan adları Gantry Studio'nun "Tool change & safe zones" ekranıyla birebir
 * aynı: aynı makinenin aynı ayarı iki arayüzde farklı adla görünürse
 * hangisinin geçerli olduğu tartışma konusu olur.
 */
export interface ToolZoneConfig {
  enabled: boolean;
  safe_z: number;
  travel_z: number;
  lift_mm: number;
  slide_axis: "x" | "y";
  approach_offset: number;
  change_speed: number;
  presence_reg: number;
  z_safe_reg: number;
  lock_servo_reg: number;
  lock_delay_ms: number;
  slots: ToolSlot[];
  zones: RestrictedZone[];
  change_area: ChangeArea;
  current_tool: string | null;
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

/**
 * Ekilebilir dikdörtgen — yatağın kenarıyla toprağın başladığı yer aynı değil.
 *
 * Kenarda profil, kablo kanalı, saksı duvarı gibi boşluklar var; tohumu oraya
 * bırakırsak toprağa değil metale düşer. `null` = o kenarda sınır yok, yani
 * yatağın kendi ölçüsü geçerli.
 */
export interface PlantingArea {
  x_min_mm: number | null;
  x_max_mm: number | null;
  y_min_mm: number | null;
  y_max_mm: number | null;
}

/** Vakumlu tohum ucu — tepsi konumu ve bekleme süreleri. */
export interface SeederConfig {
  enabled: boolean;
  vacuum_pin: number;
  tray_x_mm: number;
  tray_y_mm: number;
  tray_z_mm: number;
  pick_dwell_ms: number;
  release_dwell_ms: number;
  default_depth_mm: number;
}

/**
 * Bir bitki türü için cihaza özel ayar.
 *
 * Katalog küresel — tüm kullanıcılar aynı satırları paylaşıyor. "Benim
 * çileğim 30 cm aralıkla" demek herkesin çileğini değiştiremez, o yüzden
 * değişiklikler cihazın ayarlarında duruyor. `null` bırakılan alan katalog
 * değerine düşüyor: kullanıcı yalnızca değiştirmek istediğini yazıyor ve
 * katalog güncellenirse gerisi kendiliğinden güncel kalıyor.
 */
export interface SpeciesOverride {
  favorite: boolean;
  spread_mm: number | null;
  sow_depth_mm: number | null;
  water_ml_per_day: number | null;
  days_to_harvest: number | null;
}

export const SPECIES_OVERRIDE_DEFAULTS: SpeciesOverride = {
  favorite: false,
  spread_mm: null,
  sow_depth_mm: null,
  water_ml_per_day: null,
  days_to_harvest: null,
};

/**
 * Sulama reçetesi — robotun sulama sırasında ne yapacağı.
 *
 * Sıra eskiden koda gömülüydü. Sahada yetmiyor: kimi kurulumda hava pompası
 * suyu itmek için önce, kimi kurulumda hattı boşaltmak için sonra çalışıyor.
 */
export interface IrrigationRecipe {
  go_to_plant: boolean;
  descend: boolean;
  retract: boolean;
  water_first: boolean;
  pre_delay_ms: number;
  /** Vana açıldıktan sonra pompayı bekletme. */
  valve_lead_ms: number;
  /** Pompa durduktan sonra vanayı kapatmadan bekletme. */
  valve_lag_ms: number;
  water_ms: number;
  between_ms: number;
  /** 0 = hava pompası hiç çalışmasın. */
  air_ms: number;
  post_delay_ms: number;
}

export const IRRIGATION_DEFAULTS: IrrigationRecipe = {
  go_to_plant: true,
  descend: true,
  retract: true,
  water_first: true,
  pre_delay_ms: 0,
  valve_lead_ms: 1000,
  valve_lag_ms: 500,
  water_ms: 3000,
  between_ms: 1000,
  air_ms: 0,
  post_delay_ms: 0,
};

export interface MachineConfig {
  axes: Record<AxisName, AxisConfig>;
  /** Yumuşak sınırlar uygulansın mı? Kapalıyken hiçbir hedef reddedilmez. */
  limits_enabled: boolean;
  tool_zone: ToolZoneConfig;
  viewer: ViewerConfig;
  planting_area: PlantingArea;
  /** X/Y hareketinden önce uç güvenli yüksekliğe çekilsin mi? */
  travel_guard: boolean;
  seeder: SeederConfig;
  /** Tür kısa adına göre cihaza özel ayarlar. */
  species: Record<string, SpeciesOverride>;
  irrigation: IrrigationRecipe;
}

export const SEEDER_DEFAULTS: SeederConfig = {
  enabled: false,
  vacuum_pin: 9,
  tray_x_mm: 0,
  tray_y_mm: 0,
  tray_z_mm: 0,
  pick_dwell_ms: 800,
  release_dwell_ms: 500,
  default_depth_mm: 15,
};

export const AXIS_DEFAULTS: AxisConfig = {
  // Boş alanlar "makineninkini kullan" demek; varsayılan bir sayı koymak
  // kalibre edilmemiş bir eksende yanlış davranış üretirdi.
  cpm: null,
  dir: null,
  home_mm: null,
  min_mm: null,
  max_mm: null,
  speed: null,
  accel: null,
};

export const TOOL_ZONE_DEFAULTS: ToolZoneConfig = {
  enabled: false,
  safe_z: 0,
  travel_z: 0,
  lift_mm: 0,
  slide_axis: "y",
  approach_offset: 0,
  change_speed: 20,
  presence_reg: 0,
  z_safe_reg: 0,
  lock_servo_reg: 0,
  lock_delay_ms: 1500,
  slots: [],
  zones: [],
  change_area: { enabled: false, corners: [[0, 0], [0, 0], [0, 0], [0, 0]] },
  current_tool: null,
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
    speed: optionalNum(source.speed),
    accel: optionalNum(source.accel),
  };
}

function readChangeArea(raw: unknown): ChangeArea {
  const source = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(source.corners) ? (source.corners as unknown[]) : [];
  const corners: [number, number][] = list.slice(0, 4).map((item) => {
    const c = Array.isArray(item) ? item : [];
    return [num(c[0], 0), num(c[1], 0)];
  });
  // Dörtgen her zaman dört köşeli olsun: eksik köşe arayüzde boş kutu demek
  while (corners.length < 4) corners.push([0, 0]);
  return { enabled: Boolean(source.enabled), corners };
}

/** `device.settings` içinden eksiksiz bir yapılandırma çıkarır. */
export function readMachineConfig(settings: Record<string, unknown> | undefined): MachineConfig {
  const source = (settings ?? {}) as Record<string, unknown>;
  const rawAxes = (source.axes ?? {}) as Record<string, unknown>;
  const rawZone = (source.tool_zone ?? {}) as Record<string, unknown>;
  const rawViewer = (source.viewer ?? {}) as Record<string, unknown>;
  const rawArea = (source.planting_area ?? {}) as Record<string, unknown>;
  const rawSeeder = (source.seeder ?? {}) as Record<string, unknown>;

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
      travel_z: num(rawZone.travel_z, TOOL_ZONE_DEFAULTS.travel_z),
      lift_mm: num(rawZone.lift_mm, TOOL_ZONE_DEFAULTS.lift_mm),
      slide_axis: String(rawZone.slide_axis ?? "y").toLowerCase() === "x" ? "x" : "y",
      // Eski kurulumlarla uyum: `approach_mm` pozitif tutulup çıkarılıyordu,
      // yeni alan işaretli ve ekleniyor. Aynı şeyi anlatıyorlar.
      approach_offset:
        rawZone.approach_offset === undefined && rawZone.approach_mm !== undefined
          ? -num(rawZone.approach_mm, 0)
          : num(rawZone.approach_offset, TOOL_ZONE_DEFAULTS.approach_offset),
      change_speed: num(rawZone.change_speed, TOOL_ZONE_DEFAULTS.change_speed),
      presence_reg: num(rawZone.presence_reg, 0),
      z_safe_reg: num(rawZone.z_safe_reg, 0),
      lock_servo_reg: num(rawZone.lock_servo_reg, 0),
      lock_delay_ms: num(rawZone.lock_delay_ms, TOOL_ZONE_DEFAULTS.lock_delay_ms),
      slots: Array.isArray(rawZone.slots)
        ? (rawZone.slots as unknown[]).flatMap((item) => {
            const slot = (item ?? {}) as Record<string, unknown>;
            const name = String(slot.name ?? "").trim();
            return name
              ? [{ name, x: num(slot.x, 0), y: num(slot.y, 0), z: num(slot.z, 0) }]
              : [];
          })
        : [],
      zones: Array.isArray(rawZone.zones)
        ? (rawZone.zones as unknown[]).flatMap((item) => {
            const z = (item ?? {}) as Record<string, unknown>;
            const name = String(z.name ?? "").trim();
            return name
              ? [
                  {
                    name,
                    x1: num(z.x1, 0),
                    y1: num(z.y1, 0),
                    x2: num(z.x2, 0),
                    y2: num(z.y2, 0),
                    allow_if: String(z.allow_if ?? ""),
                  },
                ]
              : [];
          })
        : [],
      change_area: readChangeArea(rawZone.change_area),
      current_tool: rawZone.current_tool ? String(rawZone.current_tool) : null,
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
    planting_area: {
      x_min_mm: optionalNum(rawArea.x_min_mm),
      x_max_mm: optionalNum(rawArea.x_max_mm),
      y_min_mm: optionalNum(rawArea.y_min_mm),
      y_max_mm: optionalNum(rawArea.y_max_mm),
    },
    travel_guard: ((source.travel ?? {}) as Record<string, unknown>).enabled !== false,
    seeder: {
      enabled: Boolean(rawSeeder.enabled),
      vacuum_pin: num(rawSeeder.vacuum_pin, SEEDER_DEFAULTS.vacuum_pin),
      tray_x_mm: num(rawSeeder.tray_x_mm, 0),
      tray_y_mm: num(rawSeeder.tray_y_mm, 0),
      tray_z_mm: num(rawSeeder.tray_z_mm, 0),
      pick_dwell_ms: num(rawSeeder.pick_dwell_ms, SEEDER_DEFAULTS.pick_dwell_ms),
      release_dwell_ms: num(rawSeeder.release_dwell_ms, SEEDER_DEFAULTS.release_dwell_ms),
      default_depth_mm: num(rawSeeder.default_depth_mm, SEEDER_DEFAULTS.default_depth_mm),
    },
    species: readSpecies(source.species),
    irrigation: readIrrigation(source.irrigation),
  };
}

function readIrrigation(raw: unknown): IrrigationRecipe {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    go_to_plant: o.go_to_plant !== false,
    descend: o.descend !== false,
    retract: o.retract !== false,
    water_first: o.water_first !== false,
    pre_delay_ms: num(o.pre_delay_ms, 0),
    valve_lead_ms: num(o.valve_lead_ms, IRRIGATION_DEFAULTS.valve_lead_ms),
    valve_lag_ms: num(o.valve_lag_ms, IRRIGATION_DEFAULTS.valve_lag_ms),
    water_ms: num(o.water_ms, IRRIGATION_DEFAULTS.water_ms),
    between_ms: num(o.between_ms, IRRIGATION_DEFAULTS.between_ms),
    air_ms: num(o.air_ms, 0),
    post_delay_ms: num(o.post_delay_ms, 0),
  };
}

function readSpecies(raw: unknown): Record<string, SpeciesOverride> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const result: Record<string, SpeciesOverride> = {};
  for (const [slug, veri] of Object.entries(source)) {
    const o = (veri ?? {}) as Record<string, unknown>;
    result[slug] = {
      favorite: Boolean(o.favorite),
      spread_mm: optionalNum(o.spread_mm),
      sow_depth_mm: optionalNum(o.sow_depth_mm),
      water_ml_per_day: optionalNum(o.water_ml_per_day),
      days_to_harvest: optionalNum(o.days_to_harvest),
    };
  }
  return result;
}

/**
 * Katalog değeri ile kullanıcının değişikliğini birleştirir.
 *
 * Tek yerde: kart, tasarımcı ve ekim aynı sayıyı görsün. Ayrı ayrı
 * hesaplansaydı biri katalogtan, diğeri ayardan okur ve panel kendi içinde
 * çelişirdi.
 */
export function speciesValue<T extends keyof Omit<SpeciesOverride, "favorite">>(
  overrides: Record<string, SpeciesOverride>,
  slug: string,
  key: T,
  katalog: number,
): number {
  const deger = overrides[slug]?.[key];
  return deger === null || deger === undefined ? katalog : deger;
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
