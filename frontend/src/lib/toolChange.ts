/**
 * Uç alma / bırakma dizisi.
 *
 * Tek bir yerde üretiliyor: hem tablodaki önizleme hem gerçekte gönderilen
 * hareketler buradan geliyor. İkisi ayrı yazılsaydı biri değişip diğeri
 * kaldığında önizleme yalan söylerdi — ve uç değiştirmede yalan söyleyen bir
 * önizleme, sıradaki uçları süpüren bir kafa demek.
 *
 * Kural (PLC_BRIEF.md §7): **kafa ucun üstüne dikey inemez.** Uca yandan,
 * yalnızca tek eksen boyunca kayarak girer. Sıra:
 *
 *   ① Travel Z'ye çık
 *   ② yaklaşma noktasının üzerine yatayda git (hâlâ Travel Z'de)
 *   ③ ucun yanında kavrama yüksekliğine alçal
 *   ④ ucun altına kay (yalnızca kayma ekseni; diğer ikisi sabit)
 *   ⑤ kilitle
 *   ⑥ Lift kadar kaldır
 *
 * Bırakma bunun tersi.
 *
 * Travel Z **en uzun uçtan yüksek olmalı**: kafa yatayda o yükseklikte
 * gidiyor, alçak kalırsa aradaki uçlara çarpar.
 */

import type { ToolSlot, ToolZoneConfig } from "@/lib/machine";

export type ToolStep =
  | {
      kind: "move";
      x: number;
      y: number;
      z: number;
      /** Yalnızca Z oynasın: X/Y o an neredeyse orada kalsın. */
      onlyZ?: boolean;
    }
  | { kind: "lock" }
  | { kind: "unlock" };

/** Kayma ekseni boyunca kaydırılmış yaklaşma noktası. */
export function approachPoint(
  slot: ToolSlot,
  zone: ToolZoneConfig,
): { x: number; y: number } {
  return zone.slide_axis === "x"
    ? { x: slot.x + zone.approach_offset, y: slot.y }
    : { x: slot.x, y: slot.y + zone.approach_offset };
}

export function pickSteps(slot: ToolSlot, zone: ToolZoneConfig): ToolStep[] {
  const a = approachPoint(slot, zone);
  return [
    // ① Yalnızca Z: uçların üstüne çık. X/Y burada bilinmediği için hareket
    //    çağıran tarafta mevcut konumla tamamlanıyor.
    { kind: "move", x: slot.x, y: slot.y, z: zone.travel_z, onlyZ: true },
    { kind: "move", x: a.x, y: a.y, z: zone.travel_z },
    { kind: "move", x: a.x, y: a.y, z: slot.z },
    { kind: "move", x: slot.x, y: slot.y, z: slot.z },
    { kind: "lock" },
    { kind: "move", x: slot.x, y: slot.y, z: slot.z + zone.lift_mm },
  ];
}

export function dropSteps(slot: ToolSlot, zone: ToolZoneConfig): ToolStep[] {
  const a = approachPoint(slot, zone);
  return [
    { kind: "move", x: slot.x, y: slot.y, z: slot.z + zone.lift_mm },
    { kind: "move", x: slot.x, y: slot.y, z: zone.travel_z },
    { kind: "move", x: slot.x, y: slot.y, z: slot.z },
    { kind: "unlock" },
    { kind: "move", x: a.x, y: a.y, z: slot.z },
    { kind: "move", x: a.x, y: a.y, z: zone.travel_z },
  ];
}

/** Sayıyı gereksiz sıfır olmadan yazar: 70.5 → "70.5", 150.0 → "150". */
function n(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function stepText(step: ToolStep): string {
  if (step.kind === "lock") return "🔒";
  if (step.kind === "unlock") return "🔓";
  return `${n(step.x)},${n(step.y)},${n(step.z)}`;
}

/**
 * Tablonun altındaki tek satırlık özet.
 *
 * Her yuvanın kendi satırı var çünkü sayıları kafadan hesaplamak zor ve
 * yanlış bir Travel Z'nin sonucu ancak burada görülünce fark ediliyor.
 */
export function sequenceSummary(slot: ToolSlot, zone: ToolZoneConfig): string {
  const al = pickSteps(slot, zone);
  const birak = dropSteps(slot, zone);

  // İlk adım "yalnızca Z" olduğu için koordinat yerine ↑Z olarak yazılıyor:
  // o anda X/Y nerede olursa olsun hareket sadece yukarı.
  const alMetin = [`↑Z${n(zone.travel_z)}`, ...al.slice(1).map(stepText)].join(" → ");
  const birakMetin = [
    stepText(birak[0]),
    `↑Z${n(zone.travel_z)}`,
    ...birak.slice(1).map(stepText),
  ].join(" → ");

  return `al ${alMetin} · bırak ${birakMetin}`;
}
