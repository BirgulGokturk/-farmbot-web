/**
 * Bitki büyüme modeli.
 *
 * Zaman yolculuğu ve 3D görünüm, bir bitkinin belirli bir tarihteki boyutunu
 * buradan öğrenir. Eğri verisi `{gün: değer}` biçimindedir; ara günler doğrusal
 * enterpolasyonla hesaplanır.
 *
 * Eğri tanımlı değilse türün olgun ölçüsüne doğru yumuşak bir S eğrisi
 * (lojistik büyüme) kullanılır — gerçek bitki büyümesi de böyle davranır:
 * başta yavaş, ortada hızlı, sonda yine yavaş.
 */

import type { Curve, PlantStage, Point } from "./types";

const MS_PER_DAY = 86_400_000;

/** Bitkinin verilen tarihteki yaşı (gün). Ekilmemişse null. */
export function plantAgeDays(point: Point, at: Date): number | null {
  if (!point.planted_at) return null;
  const planted = new Date(point.planted_at).getTime();
  const age = (at.getTime() - planted) / MS_PER_DAY;
  return age < 0 ? null : age;
}

/**
 * `{gün: değer}` eğrisini verilen günde örnekler.
 * Aralık dışında kalan günler için uçtaki değer kullanılır.
 */
export function sampleCurve(data: Record<string, number>, day: number): number | null {
  const points = Object.entries(data)
    .map(([key, value]) => [Number(key), Number(value)] as const)
    .filter(([d, v]) => Number.isFinite(d) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);

  if (points.length === 0) return null;
  if (points.length === 1) return points[0][1];

  const first = points[0];
  const last = points[points.length - 1];
  if (day <= first[0]) return first[1];
  if (day >= last[0]) return last[1];

  for (let i = 0; i < points.length - 1; i++) {
    const [dayA, valueA] = points[i];
    const [dayB, valueB] = points[i + 1];
    if (day >= dayA && day <= dayB) {
      const span = dayB - dayA;
      if (span === 0) return valueB;
      const ratio = (day - dayA) / span;
      return valueA + (valueB - valueA) * ratio;
    }
  }
  return last[1];
}

/**
 * Eğri yokken kullanılan lojistik büyüme.
 * `progress` 0..1 arası; olgunluk oranını döndürür (0.08 .. 1).
 */
function logisticGrowth(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  // Fide bile sıfır boyutlu değildir; tabanı %8'de tutuyoruz
  const raw = 1 / (1 + Math.exp(-10 * (clamped - 0.45)));
  const min = 1 / (1 + Math.exp(10 * 0.45));
  const max = 1 / (1 + Math.exp(-10 * 0.55));
  return 0.08 + 0.92 * ((raw - min) / (max - min));
}

export interface GrowthState {
  /** O tarihteki yarıçap (mm) */
  radiusMm: number;
  /** O tarihteki boy (mm) — 3D görünüm kullanır */
  heightMm: number;
  /** 0..1 olgunluk oranı */
  maturity: number;
  /** Bitki o tarihte bahçede var mı? */
  present: boolean;
  /** O tarihteki tahmini aşama */
  stage: PlantStage;
}

/**
 * Bir bitkinin verilen tarihteki durumunu hesaplar.
 *
 * `curves` verilirse (id → eğri) bitkinin kendi eğrileri kullanılır.
 */
export function growthAt(
  point: Point,
  at: Date,
  curves?: Map<string, Curve>,
): GrowthState {
  const matureRadius = point.radius_mm;
  const daysToHarvest = point.species?.days_to_harvest ?? 60;

  // Ekim tarihi yoksa (yalnızca planlanmış) tasarımdaki olgun ölçüsünü göster
  const age = plantAgeDays(point, at);
  if (age === null) {
    const plantedLater =
      point.planted_at !== null && new Date(point.planted_at) > at;
    return {
      radiusMm: matureRadius,
      heightMm: matureRadius * 0.9,
      maturity: 1,
      // Gelecekte ekilecekse o tarihte henüz yok
      present: !plantedLater,
      stage: point.stage,
    };
  }

  // --- Yayılma ---
  const spreadCurve = point.spread_curve_id
    ? curves?.get(point.spread_curve_id)
    : undefined;
  const spreadFromCurve = spreadCurve ? sampleCurve(spreadCurve.data, age) : null;

  const maturity = logisticGrowth(age / Math.max(1, daysToHarvest));
  const radiusMm =
    spreadFromCurve !== null && spreadFromCurve !== undefined
      ? spreadFromCurve / 2
      : matureRadius * maturity;

  // --- Boy ---
  const heightCurve = point.height_curve_id
    ? curves?.get(point.height_curve_id)
    : undefined;
  const heightFromCurve = heightCurve ? sampleCurve(heightCurve.data, age) : null;
  const heightMm =
    heightFromCurve !== null && heightFromCurve !== undefined
      ? heightFromCurve
      : matureRadius * 0.9 * maturity;

  return {
    radiusMm: Math.max(6, radiusMm),
    heightMm: Math.max(4, heightMm),
    maturity,
    present: true,
    stage: stageForAge(age, daysToHarvest, point.stage),
  };
}

/** Yaşa göre tahmini aşama — geçmişe/geleceğe bakarken kayıtlı aşama yanıltmasın. */
function stageForAge(age: number, daysToHarvest: number, current: PlantStage): PlantStage {
  // Kullanıcı elle "kaldırıldı"/"hasat edildi" dediyse ona saygı göster
  if (current === "removed" || current === "harvested") return current;
  if (age < 3) return "planted";
  if (age < daysToHarvest * 0.25) return "sprouted";
  if (age < daysToHarvest) return "active";
  return "harvested";
}

/** Günlük su ihtiyacı — sulama eğrisi varsa ondan, yoksa türün sabitinden. */
export function waterNeedMl(
  point: Point,
  at: Date,
  curves?: Map<string, Curve>,
): number {
  const age = plantAgeDays(point, at);
  const fallback = point.species?.water_ml_per_day ?? 200;
  if (age === null) return fallback;

  const curve = point.water_curve_id ? curves?.get(point.water_curve_id) : undefined;
  const value = curve ? sampleCurve(curve.data, age) : null;
  return value ?? fallback;
}
