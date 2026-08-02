/**
 * Tarla tasarımcısının 3D perspektif modu.
 *
 * 2D tuvalle aynı veriyi kullanır: aynı seçim, aynı taşıma geri çağrıları,
 * aynı zaman yolculuğu tarihi. Böylece iki mod arasında geçiş yaparken
 * kullanıcı hiçbir şey kaybetmez.
 *
 * Sahne birimi metredir; veri milimetre olduğu için MM (=0.001) ile ölçeklenir.
 * Dünya ↔ sahne eşlemesi: bahçe X → sahne X, bahçe Y → sahne Z.
 */

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { Group } from "three";

import { Spinner } from "@/components/ui/primitives";
import { growthAt } from "@/lib/growth";
import type { Curve, Device, Point, Position } from "@/lib/types";
import type { PointMove } from "./GardenCanvas";

const MM = 0.001;
/** Robot hareketini yumuşatan yaklaşma katsayısı. */
const SMOOTHING = 0.14;
const GANTRY_HEIGHT = 1.0;

interface Garden3DProps {
  device: Device;
  points: Point[];
  botPosition: Position;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onMovePoints: (moves: PointMove[], previous: PointMove[]) => void;
  viewDate: Date;
  curves: Map<string, Curve>;
}

export function Garden3D(props: Garden3DProps) {
  const width = props.device.bed_width_mm * MM;
  const length = props.device.bed_length_mm * MM;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-card)] border border-line">
      <Suspense
        fallback={
          <div className="grid size-full place-items-center bg-surface-2">
            <Spinner className="size-7 text-brand" />
          </div>
        }
      >
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [width / 2, 2.6, length + 2.4], fov: 45 }}
        >
          <Scene {...props} />
        </Canvas>
      </Suspense>

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg glass px-2.5 py-1.5 text-xs text-muted">
        Döndür: sürükle · Yakınlaş: tekerlek · Bitkiyi taşı: üzerine bas ve sürükle
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function Scene({
  device,
  points,
  botPosition,
  selectedIds,
  onSelectionChange,
  onMovePoints,
  viewDate,
  curves,
}: Garden3DProps) {
  const width = device.bed_width_mm * MM;
  const length = device.bed_length_mm * MM;

  /** Sürükleme sırasında noktaların geçici konumu (mm). */
  const [drag, setDrag] = useState<{
    ids: string[];
    start: Map<string, { x: number; y: number }>;
    current: Map<string, { x: number; y: number }>;
    anchor: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const rendered = useMemo(
    () => points.map((point) => ({ point, growth: growthAt(point, viewDate, curves) })),
    [points, viewDate, curves],
  );

  function startDrag(event: ThreeEvent<PointerEvent>, point: Point) {
    event.stopPropagation();

    const ids = selected.has(point.id) ? selectedIds : [point.id];
    if (!selected.has(point.id)) onSelectionChange([point.id]);

    const start = new Map<string, { x: number; y: number }>();
    for (const item of points) {
      if (ids.includes(item.id)) start.set(item.id, { x: item.x, y: item.y });
    }

    setDrag({
      ids,
      start,
      current: new Map(start),
      // Tıklanan dünya noktası çapa; fare oradan ne kadar kaydıysa bitkiler de o kadar kayar
      anchor: { x: event.point.x / MM, y: event.point.z / MM },
      moved: false,
    });
  }

  /** Zemindeki hareket: sürükleme varsa noktaları taşı. */
  function handleGroundMove(event: ThreeEvent<PointerEvent>) {
    if (!drag) return;
    const worldX = event.point.x / MM;
    const worldY = event.point.z / MM;
    const deltaX = worldX - drag.anchor.x;
    const deltaY = worldY - drag.anchor.y;

    const next = new Map<string, { x: number; y: number }>();
    for (const [id, start] of drag.start) {
      next.set(id, {
        x: Math.round(Math.max(0, Math.min(device.bed_width_mm, start.x + deltaX))),
        y: Math.round(Math.max(0, Math.min(device.bed_length_mm, start.y + deltaY))),
      });
    }
    setDrag({ ...drag, current: next, moved: true });
  }

  function endDrag() {
    if (!drag) return;
    if (drag.moved) {
      const moves: PointMove[] = [];
      const previous: PointMove[] = [];
      for (const [id, position] of drag.current) {
        const start = drag.start.get(id);
        if (!start) continue;
        moves.push({ id, x: position.x, y: position.y });
        previous.push({ id, x: start.x, y: start.y });
      }
      if (moves.length) onMovePoints(moves, previous);
    }
    setDrag(null);
  }

  return (
    <>
      {/* Aydınlatma tamamen yerel — dış CDN'den HDRI indirilmez */}
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#cfe9ff", "#2f2013", 0.75]} />
      <directionalLight
        position={[width + 2, 5, length + 2]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <directionalLight position={[-3, 3, -3]} intensity={0.35} />

      {/* Çim zemin */}
      <mesh
        position={[width / 2, -0.12, length / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[width + 14, length + 14]} />
        <meshStandardMaterial color="#2f5d33" roughness={1} />
      </mesh>

      {/* Ahşap yatak çerçevesi */}
      <BedFrame width={width} length={length} />

      {/* Toprak yüzeyi — sürükleme bu düzlemde yakalanır */}
      <mesh
        position={[width / 2, 0, length / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onPointerMove={handleGroundMove}
        onPointerUp={endDrag}
        onPointerMissed={() => onSelectionChange([])}
      >
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#3a2a1c" roughness={0.98} />
      </mesh>

      {/* Toprak üzerindeki ekim ızgarası */}
      <SoilGrid width={width} length={length} step={0.25} />

      <RobotRig
        length={length}
        target={{ x: botPosition.x * MM, y: botPosition.y * MM, z: botPosition.z * MM }}
      />

      {/* Bitkiler */}
      {rendered.map(({ point, growth }) => {
        const position = drag?.current.get(point.id);
        const x = (position?.x ?? point.x) * MM;
        const z = (position?.y ?? point.y) * MM;
        return (
          <Plant3D
            key={point.id}
            x={x}
            z={z}
            radius={Math.max(0.03, growth.radiusMm * MM)}
            height={Math.max(0.03, growth.heightMm * MM)}
            color={point.species?.color ?? "#38bdf8"}
            label={point.name}
            selected={selected.has(point.id)}
            faded={!growth.present}
            onPointerDown={(event) => startDrag(event, point)}
            onPointerUp={endDrag}
          />
        );
      })}

      <OrbitControls
        target={[width / 2, 0.25, length / 2]}
        enableDamping
        // Bitki sürüklenirken kamera dönmesin
        enabled={drag === null}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={1.2}
        maxDistance={24}
      />
    </>
  );
}

// --------------------------------------------------------------------------- //

function BedFrame({ width, length }: { width: number; length: number }) {
  const wood = "#7a4f2a";
  const thickness = 0.07;
  const height = 0.24;
  const y = height / 2 - 0.12;

  return (
    <group>
      {/* Uzun kenarlar */}
      <mesh position={[width / 2, y, -thickness / 2]} castShadow receiveShadow>
        <boxGeometry args={[width + thickness * 2, height, thickness]} />
        <meshStandardMaterial color={wood} roughness={0.9} />
      </mesh>
      <mesh position={[width / 2, y, length + thickness / 2]} castShadow receiveShadow>
        <boxGeometry args={[width + thickness * 2, height, thickness]} />
        <meshStandardMaterial color={wood} roughness={0.9} />
      </mesh>
      {/* Kısa kenarlar */}
      <mesh position={[-thickness / 2, y, length / 2]} castShadow receiveShadow>
        <boxGeometry args={[thickness, height, length]} />
        <meshStandardMaterial color={wood} roughness={0.9} />
      </mesh>
      <mesh position={[width + thickness / 2, y, length / 2]} castShadow receiveShadow>
        <boxGeometry args={[thickness, height, length]} />
        <meshStandardMaterial color={wood} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Toprağın üzerine ince ekim ızgarası çizer. */
function SoilGrid({ width, length, step }: { width: number; length: number; step: number }) {
  const lines = useMemo(() => {
    const segments: number[] = [];
    for (let x = 0; x <= width + 0.001; x += step) {
      segments.push(x, 0.002, 0, x, 0.002, length);
    }
    for (let z = 0; z <= length + 0.001; z += step) {
      segments.push(0, 0.002, z, width, 0.002, z);
    }
    return new Float32Array(segments);
  }, [width, length, step]);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[lines, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.12} />
    </lineSegments>
  );
}

/** Portal + çapraz kızak + Z ekseni; hedefe yumuşak geçişle yaklaşır. */
function RobotRig({
  length,
  target,
}: {
  length: number;
  target: { x: number; y: number; z: number };
}) {
  const gantry = useRef<Group>(null);
  const carriage = useRef<Group>(null);
  const zAxis = useRef<Group>(null);

  useFrame(() => {
    if (gantry.current) {
      gantry.current.position.x += (target.x - gantry.current.position.x) * SMOOTHING;
    }
    if (carriage.current) {
      carriage.current.position.z += (target.y - carriage.current.position.z) * SMOOTHING;
    }
    if (zAxis.current) {
      // Robotta Z aşağı doğru negatiftir
      const desired = Math.min(0, target.z);
      zAxis.current.position.y += (desired - zAxis.current.position.y) * SMOOTHING;
    }
  });

  const metal = "#c9d3dc";

  return (
    <group ref={gantry}>
      {/* Dikey sütunlar */}
      {[0, length].map((z) => (
        <mesh key={z} position={[0, GANTRY_HEIGHT / 2, z]} castShadow>
          <boxGeometry args={[0.11, GANTRY_HEIGHT, 0.13]} />
          <meshStandardMaterial color={metal} metalness={0.65} roughness={0.35} />
        </mesh>
      ))}

      {/* Üst kiriş */}
      <mesh position={[0, GANTRY_HEIGHT, length / 2]} castShadow>
        <boxGeometry args={[0.11, 0.11, length + 0.26]} />
        <meshStandardMaterial color="#e6ecf1" metalness={0.6} roughness={0.35} />
      </mesh>

      {/* Çapraz kızak (Y ekseni) */}
      <group ref={carriage}>
        <mesh position={[0, GANTRY_HEIGHT, 0]} castShadow>
          <boxGeometry args={[0.24, 0.2, 0.24]} />
          <meshStandardMaterial color="#34d399" metalness={0.3} roughness={0.35} />
        </mesh>

        {/* Z ekseni ve alet başlığı */}
        <group ref={zAxis}>
          <mesh position={[0, GANTRY_HEIGHT - 0.32, 0]} castShadow>
            <boxGeometry args={[0.075, 0.64, 0.075]} />
            <meshStandardMaterial color="#96a3ad" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, GANTRY_HEIGHT - 0.66, 0]} castShadow>
            <cylinderGeometry args={[0.055, 0.038, 0.13, 20]} />
            <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.4} />
          </mesh>
        </group>
      </group>

      {/* X konumunu toprakta gösteren iz */}
      <mesh position={[0, 0.004, length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.025, length]} />
        <meshBasicMaterial color="#10b981" transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

function Plant3D({
  x,
  z,
  radius,
  height,
  color,
  label,
  selected,
  faded,
  onPointerDown,
  onPointerUp,
}: {
  x: number;
  z: number;
  radius: number;
  height: number;
  color: string;
  label: string;
  selected: boolean;
  faded: boolean;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Yaprak kütlesi boy ve yayılmanın ortalamasıyla ölçeklenir
  const bushRadius = Math.max(0.02, Math.min(radius * 0.62, height * 0.55));

  return (
    <group position={[x, 0, z]}>
      {/* Yayılma alanı halkası */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.9, radius, 48]} />
        <meshBasicMaterial
          color={selected ? "#34d399" : color}
          transparent
          opacity={faded ? 0.2 : selected ? 0.85 : 0.45}
        />
      </mesh>

      {/* Gövde */}
      <mesh position={[0, bushRadius * 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.008, 0.012, bushRadius, 8]} />
        <meshStandardMaterial color="#4d7c2f" />
      </mesh>

      {/* Yaprak kütlesi */}
      <mesh
        position={[0, bushRadius * 1.05, 0]}
        castShadow
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[bushRadius, 20, 16]} />
        <meshStandardMaterial
          color={color}
          roughness={0.75}
          transparent={faded}
          opacity={faded ? 0.35 : 1}
          emissive={selected ? "#34d399" : "#000000"}
          emissiveIntensity={selected ? 0.28 : 0}
        />
      </mesh>

      {(hovered || selected) && (
        <Html
          position={[0, bushRadius * 2.2 + 0.05, 0]}
          center
          distanceFactor={8}
          className="pointer-events-none select-none whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
        >
          {label}
        </Html>
      )}
    </group>
  );
}
