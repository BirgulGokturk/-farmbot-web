/**
 * Robotun gerçek zamanlı 3B dijital ikizi.
 *
 * Sahne birimi metredir; veriler milimetre geldiği için /1000 ile ölçeklenir.
 * Gantry X ekseninde, çapraz kızak Y ekseninde, alet başlığı Z ekseninde
 * robotun canlı konumuna göre hareket eder.
 */

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Info } from "lucide-react";
import type { Group } from "three";

import { Badge, Card, PageHeader, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBot } from "@/store/useBot";
import type { Device, Point } from "@/lib/types";

/** Milimetreden sahne birimine (metre). */
const MM = 0.001;
/** Konum sıçramalarını yumuşatan yaklaşma katsayısı. */
const SMOOTHING = 0.12;

export default function Viewer3D() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const status = useBot((s) => s.status);

  const { data: points } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const position = status?.position ?? { x: 0, y: 0, z: 0 };

  return (
    <div className="space-y-5">
      <PageHeader
        title="3D Görünüm"
        description="Robotun gerçek zamanlı dijital ikizi"
        icon={<Boxes className="size-5" />}
        actions={
          <Badge tone="brand" className="font-mono">
            X {Math.round(position.x)} · Y {Math.round(position.y)} · Z {Math.round(position.z)}
          </Badge>
        }
      />

      <Card flush className="overflow-hidden">
        <div className="relative h-[65vh] min-h-[420px] w-full bg-gradient-to-b from-[#0b1416] to-[#060a0b]">
          {device ? (
            <Suspense
              fallback={
                <div className="grid size-full place-items-center">
                  <Spinner className="size-7 text-brand" />
                </div>
              }
            >
              <Canvas
                shadows
                camera={{
                  // Yatağı ekrana dolduracak mesafe: yarım genişlik / tan(fov/2)
                  position: [
                    (device.bed_width_mm * MM) / 2,
                    2.4,
                    device.bed_length_mm * MM + 2.0,
                  ],
                  fov: 45,
                }}
                dpr={[1, 2]}
              >
                <Scene device={device} points={points ?? []} position={position} />
              </Canvas>
            </Suspense>
          ) : (
            <div className="grid size-full place-items-center text-subtle">
              <Spinner className="size-7" />
            </div>
          )}

          {/* Kullanım ipucu */}
          <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-lg glass px-3 py-2 text-xs text-muted">
            <Info className="size-3.5" />
            Döndürmek için sürükleyin · yakınlaşmak için tekerleği kullanın
          </div>
        </div>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function Scene({
  device,
  points,
  position,
}: {
  device: Device;
  points: Point[];
  position: { x: number; y: number; z: number };
}) {
  const width = device.bed_width_mm * MM;
  const length = device.bed_length_mm * MM;
  const height = 1.0; // portal yüksekliği (m)

  const plants = useMemo(
    () => points.filter((p) => p.point_type === "plant" && p.species),
    [points],
  );

  return (
    <>
      {/*
        Aydınlatma tamamen yerel: drei'nin `Environment` bileşeni HDRI dosyasını
        dış bir CDN'den indirir. Bu uygulama çiftlikte, internetsiz bir yerel ağda
        da çalışabilmeli — bu yüzden ışıkları elle kuruyoruz.
      */}
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#bfe8ff", "#2b1d12", 0.7]} />
      <directionalLight
        position={[width, 4, length]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-2, 2.5, -2]} intensity={0.4} />

      {/* Toprak yatağı */}
      <mesh position={[width / 2, -0.02, length / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#3b2a1d" roughness={0.95} />
      </mesh>

      {/* Zemin ızgarası */}
      <Grid
        position={[width / 2, -0.03, length / 2]}
        args={[width + 2, length + 2]}
        cellSize={0.25}
        cellColor="#1f3a36"
        sectionSize={1}
        sectionColor="#2f6b60"
        fadeDistance={22}
        infiniteGrid={false}
      />

      {/* Yan raylar */}
      <Rail x={width / 2} z={0} length={width} />
      <Rail x={width / 2} z={length} length={width} />

      {/* Hareketli robot */}
      <RobotRig
        length={length}
        height={height}
        target={{
          x: position.x * MM,
          y: position.y * MM,
          z: position.z * MM,
        }}
      />

      {/* Bitkiler */}
      {plants.map((plant) => (
        <Plant3D
          key={plant.id}
          x={plant.x * MM}
          z={plant.y * MM}
          radius={Math.max(0.04, plant.radius_mm * MM)}
          color={plant.species!.color}
          label={plant.name}
        />
      ))}

      <OrbitControls
        target={[width / 2, 0.3, length / 2]}
        enableDamping
        maxPolarAngle={Math.PI / 2.1}
        minDistance={1.5}
        maxDistance={20}
      />
    </>
  );
}

/** Boyuna uzanan alüminyum ray. */
function Rail({ x, z, length }: { x: number; z: number; length: number }) {
  return (
    <mesh position={[x, 0.04, z]} castShadow receiveShadow>
      <boxGeometry args={[length, 0.08, 0.08]} />
      <meshStandardMaterial color="#8b98a5" metalness={0.75} roughness={0.35} />
    </mesh>
  );
}

/**
 * Portal + çapraz kızak + Z ekseni.
 * Konum, ani sıçrama yerine yumuşak geçişle hedefe yaklaşır.
 */
function RobotRig({
  length,
  height,
  target,
}: {
  length: number;
  height: number;
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
      // Robotta Z aşağı doğru negatiftir; sahnede de aşağı indiriyoruz
      const desired = Math.min(0, target.z);
      zAxis.current.position.y += (desired - zAxis.current.position.y) * SMOOTHING;
    }
  });

  return (
    <group ref={gantry}>
      {/* Dikey sütunlar */}
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[0.1, height, 0.12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, height / 2, length]} castShadow>
        <boxGeometry args={[0.1, height, 0.12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Üst çapraz kiriş */}
      <mesh position={[0, height, length / 2]} castShadow>
        <boxGeometry args={[0.1, 0.1, length + 0.2]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Çapraz kızak (Y ekseni) */}
      <group ref={carriage}>
        <mesh position={[0, height, 0]} castShadow>
          <boxGeometry args={[0.22, 0.18, 0.22]} />
          <meshStandardMaterial color="#34d399" metalness={0.35} roughness={0.35} />
        </mesh>

        {/* Z ekseni kolonu ve alet başlığı */}
        <group ref={zAxis}>
          <mesh position={[0, height - 0.3, 0]} castShadow>
            <boxGeometry args={[0.07, 0.6, 0.07]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, height - 0.62, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.035, 0.12, 16]} />
            <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.35} />
          </mesh>
        </group>
      </group>

      {/* X eksenindeki konumu zeminde gösteren iz */}
      <mesh position={[0, 0.001, length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.02, length]} />
        <meshBasicMaterial color="#10b981" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Plant3D({
  x,
  z,
  radius,
  color,
  label,
}: {
  x: number;
  z: number;
  radius: number;
  color: string;
  label: string;
}) {
  return (
    <group position={[x, 0, z]}>
      {/* Yayılma alanı halkası */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.92, radius, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} />
      </mesh>
      {/* Bitki gövdesi */}
      <mesh position={[0, radius * 0.6, 0]} castShadow>
        <sphereGeometry args={[radius * 0.6, 18, 14]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Yakınlaşınca okunabilen etiket */}
      <Html
        position={[0, radius * 1.4, 0]}
        center
        distanceFactor={9}
        className="pointer-events-none select-none whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
      >
        {label}
      </Html>
    </group>
  );
}
