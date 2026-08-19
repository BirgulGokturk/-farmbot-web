/**
 * 3B bitki modeli — türe göre gerçek siluet, olgunlukta gerçek meyve.
 *
 * Önceki sürümde bütün türler aynı geometriydi, yalnızca rengi değişiyordu:
 * çilek ile mısır aynı görünüyordu. Oysa bir bahçede türleri birbirinden
 * ayıran şey renk değil, **büyüme biçimi** — mısır tek uzun sap, marul yere
 * yayılan bir gül, çilek sürünen bir bitki.
 *
 * İki katman var:
 *
 *   1. **Gövde** — türün büyüme biçimine göre çiziliyor (aşağıdaki FORM).
 *      Siluet uzaktan bile hangi bitki olduğunu söylüyor.
 *   2. **Meyve** — olgunlaşınca türün kendi görseli beliriyor. Emoji'yi doku
 *      olarak kullanıyoruz: her sebze için ayrı 3B model hazırlamak gerekmiyor,
 *      dış dosya indirilmiyor (uygulama internetsiz ağda da çalışmalı) ve
 *      "bu bir çilek" bilgisi bir bakışta okunuyor.
 */

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { CanvasTexture, SRGBColorSpace } from "three";

/** Bitkinin büyüme biçimi — siluetini bu belirliyor. */
export type PlantForm = "stalk" | "vine" | "rosette" | "root" | "bush" | "herb";

/**
 * Tür → büyüme biçimi.
 *
 * Katalogda böyle bir alan yok; eklemek göç gerektirirdi ve biçim bilgisi
 * zaten sabit (mısır her zaman sap, marul her zaman gül). Bilinmeyen bir tür
 * gelirse "bush" makul bir orta yol.
 */
const FORM_BY_SLUG: Record<string, PlantForm> = {
  misir: "stalk",
  cilek: "vine",
  kabak: "vine",
  salatalik: "vine",
  marul: "rosette",
  ispanak: "rosette",
  brokoli: "rosette",
  havuc: "root",
  turp: "root",
  sogan: "root",
  sarimsak: "root",
  domates: "bush",
  biber: "bush",
  patlican: "bush",
  "fesleğen": "herb",
  feslegen: "herb",
  nane: "herb",
};

export function formForSlug(slug: string): PlantForm {
  return FORM_BY_SLUG[slug] ?? "bush";
}

/**
 * Emoji'den doku üretir ve önbelleğe alır.
 *
 * Önbellek modül düzeyinde: aynı türden elli bitki varsa elli doku üretmek
 * hem belleği hem GPU'yu boşuna meşgul ederdi. Doku bir kez üretilip paylaşılır.
 */
const textureCache = new Map<string, CanvasTexture>();

function emojiTexture(emoji: string): CanvasTexture {
  const cached = textureCache.get(emoji);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.font = `${size * 0.78}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size * 0.54);
  }

  const texture = new CanvasTexture(canvas);
  // Emoji sRGB alanında çizildi; belirtmezsek sahnede soluk görünüyor
  texture.colorSpace = SRGBColorSpace;
  textureCache.set(emoji, texture);
  return texture;
}

const STEM = "#4a7c3f";

/** Tek yaprak — düzleştirilip eğilmiş yüzey; küre değil. */
function Leaf({
  size,
  angle,
  tilt,
  y,
  color,
  slim = 1,
}: {
  size: number;
  angle: number;
  tilt: number;
  y: number;
  color: string;
  /** 1 = normal genişlik, <1 = ince/uzun (mısır, havuç) */
  slim?: number;
}) {
  return (
    <group position={[0, y, 0]} rotation={[0, angle, 0]}>
      <mesh
        position={[size * 0.55, 0, 0]}
        rotation={[0, 0, -tilt]}
        scale={[1, 0.16, 0.6 * slim]}
        castShadow
      >
        <sphereGeometry args={[size * 0.62, 12, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.02} />
      </mesh>
    </group>
  );
}

/** Olgun meyve — türün kendi görseli, kameraya dönük. */
function Fruit({
  emoji,
  size,
  position,
}: {
  emoji: string;
  size: number;
  position: [number, number, number];
}) {
  const texture = useMemo(() => emojiTexture(emoji), [emoji]);
  return (
    <sprite position={position} scale={[size, size, size]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

export interface PlantModelProps {
  x: number;
  z: number;
  base: number;
  radius: number;
  species: { slug: string; name_tr: string; color: string; icon: string };
  /** 0–1 olgunluk */
  progress: number;
  fontScale: number;
  showLabel: boolean;
}

export function PlantModel({
  x,
  z,
  base,
  radius,
  species,
  progress,
  fontScale,
  showLabel,
}: PlantModelProps) {
  const form = formForSlug(species.slug);
  const grown = Math.max(0, (progress - 0.12) / 0.88);
  // Meyve olgunluğun ikinci yarısında beliriyor
  const fruiting = Math.max(0, (progress - 0.55) / 0.45);

  /** Yapraklar altın açıyla dağıtılıyor: eşit aralık yapay duruyor. */
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angles = useMemo(
    () => Array.from({ length: 9 }, (_, i) => i * golden),
    [golden],
  );

  const body = (() => {
    switch (form) {
      // --- Mısır: tek uzun sap, uzun sarkan yapraklar, sapta koçan ---
      case "stalk": {
        const h = radius * (0.6 + grown * 3.2);
        return (
          <>
            <mesh position={[0, h / 2, 0]} castShadow>
              <cylinderGeometry args={[radius * 0.05, radius * 0.09, h, 7]} />
              <meshStandardMaterial color={STEM} roughness={0.85} />
            </mesh>
            {angles.slice(0, 6).map((a, i) => (
              <Leaf
                key={i}
                size={radius * (1.1 - i * 0.09)}
                angle={a}
                tilt={0.35 + i * 0.14}
                y={h * (0.25 + i * 0.12)}
                color={species.color}
                slim={0.32}
              />
            ))}
            {fruiting > 0.05 && (
              <Fruit
                emoji={species.icon}
                size={radius * 0.75 * fruiting}
                position={[radius * 0.18, h * 0.45, 0]}
              />
            )}
          </>
        );
      }

      // --- Çilek / kabak: yere yayılan, meyve toprakta ---
      case "vine": {
        const h = radius * (0.2 + grown * 0.45);
        return (
          <>
            {angles.slice(0, 7).map((a, i) => (
              <Leaf
                key={i}
                size={radius * (0.55 + (i % 3) * 0.1) * (0.4 + grown * 0.8)}
                angle={a}
                tilt={1.25}
                y={h * (0.4 + (i % 3) * 0.2)}
                color={species.color}
              />
            ))}
            {fruiting > 0.05 &&
              angles.slice(0, 3).map((a, i) => (
                <Fruit
                  key={i}
                  emoji={species.icon}
                  size={radius * 0.5 * fruiting}
                  position={[
                    Math.cos(a + 0.7) * radius * 0.5,
                    radius * 0.22 * fruiting,
                    Math.sin(a + 0.7) * radius * 0.5,
                  ]}
                />
              ))}
          </>
        );
      }

      // --- Marul / brokoli: sapsız, iç içe geçen geniş yapraklar ---
      case "rosette": {
        const h = radius * (0.15 + grown * 0.7);
        return (
          <>
            {angles.map((a, i) => {
              const t = i / (angles.length - 1);
              return (
                <Leaf
                  key={i}
                  size={radius * (0.95 - t * 0.45) * (0.35 + grown * 0.8)}
                  angle={a}
                  tilt={1.15 - t * 0.7}
                  y={h * (0.15 + t * 0.85)}
                  color={species.color}
                />
              );
            })}
            {fruiting > 0.05 && (
              <Fruit
                emoji={species.icon}
                size={radius * 0.8 * fruiting}
                position={[0, h * 1.05, 0]}
              />
            )}
          </>
        );
      }

      // --- Havuç / turp / soğan: dik ince yapraklar, toprakta şişkinlik ---
      case "root": {
        const h = radius * (0.5 + grown * 1.9);
        return (
          <>
            <mesh position={[0, radius * 0.1, 0]} castShadow>
              <sphereGeometry args={[radius * 0.3 * (0.3 + grown), 12, 8]} />
              <meshStandardMaterial color={species.color} roughness={0.6} />
            </mesh>
            {angles.slice(0, 7).map((a, i) => (
              <Leaf
                key={i}
                size={radius * 0.75 * (0.3 + grown * 0.9)}
                angle={a}
                tilt={0.25 + (i % 3) * 0.18}
                y={h * (0.4 + (i % 3) * 0.18)}
                color="#3f8f36"
                slim={0.22}
              />
            ))}
            {fruiting > 0.05 && (
              <Fruit
                emoji={species.icon}
                size={radius * 0.6 * fruiting}
                position={[radius * 0.42, radius * 0.35, 0]}
              />
            )}
          </>
        );
      }

      // --- Fesleğen / nane: alçak, sık, küçük yapraklı ---
      case "herb": {
        const h = radius * (0.3 + grown * 1.0);
        return (
          <>
            <mesh position={[0, h / 2, 0]} castShadow>
              <cylinderGeometry args={[radius * 0.03, radius * 0.05, h, 6]} />
              <meshStandardMaterial color={STEM} roughness={0.9} />
            </mesh>
            {angles.map((a, i) => (
              <Leaf
                key={i}
                size={radius * 0.4 * (0.35 + grown * 0.75)}
                angle={a}
                tilt={0.85}
                y={h * (0.25 + (i / angles.length) * 0.7)}
                color={species.color}
              />
            ))}
          </>
        );
      }

      // --- Domates / biber / patlıcan: dallı çalı, meyveler sarkıyor ---
      default: {
        const h = radius * (0.4 + grown * 1.7);
        return (
          <>
            <mesh position={[0, h / 2, 0]} castShadow>
              <cylinderGeometry args={[radius * 0.04, radius * 0.075, h, 7]} />
              <meshStandardMaterial color={STEM} roughness={0.85} />
            </mesh>
            {angles.slice(0, 7).map((a, i) => (
              <Leaf
                key={i}
                size={radius * (0.65 - (i % 3) * 0.08) * (0.35 + grown * 0.85)}
                angle={a}
                tilt={0.7 + (i % 2) * 0.3}
                y={h * (0.3 + (i / 7) * 0.65)}
                color={species.color}
              />
            ))}
            {fruiting > 0.05 &&
              angles.slice(0, 3).map((a, i) => (
                <Fruit
                  key={i}
                  emoji={species.icon}
                  size={radius * 0.52 * fruiting}
                  position={[
                    Math.cos(a + 1.1) * radius * 0.38,
                    h * (0.45 + i * 0.12),
                    Math.sin(a + 1.1) * radius * 0.38,
                  ]}
                />
              ))}
          </>
        );
      }
    }
  })();

  return (
    <group position={[x, base, z]}>
      {/* Ekim noktası — bitki görünmeden önce de yerini belli etsin */}
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.3, 20]} />
        <meshStandardMaterial color="#3d2a1a" roughness={1} />
      </mesh>

      {/* Yayılma halkası */}
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.94, radius, 40]} />
        <meshBasicMaterial color={species.color} transparent opacity={0.3} />
      </mesh>

      {progress > 0.12 && body}

      {showLabel && (
        <Html
          position={[0, radius * (1.2 + progress), 0]}
          center
          distanceFactor={2.5 * fontScale}
          className="pointer-events-none select-none whitespace-nowrap rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white"
        >
          {species.icon} {species.name_tr}
        </Html>
      )}
    </group>
  );
}
