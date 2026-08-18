/**
 * Robotun gerçek zamanlı 3B dijital ikizi.
 *
 * Sahne birimi metredir; veriler milimetre geldiği için /1000 ile ölçeklenir.
 * Gantry X ekseninde, çapraz kızak Y ekseninde, alet başlığı Z ekseninde
 * robotun canlı konumuna göre hareket eder.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Info, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import type { Group } from "three";

import { Badge, Button, Card, PageHeader, Spinner, Toggle } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { readMachineConfig, VIEWER_DEFAULTS, type ViewerConfig } from "@/lib/machine";
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
  const [panelOpen, setPanelOpen] = useState(false);

  const stored = readMachineConfig(device?.settings);
  // Kaydetmeden önce de sonucu görebilmek için görünüm ayarları yerel durumda
  // tutuluyor; kaydırıcıyı oynatınca sahne anında tepki veriyor.
  const [viewer, setViewer] = useState<ViewerConfig>(stored.viewer);

  useEffect(() => {
    if (device) setViewer(readMachineConfig(device.settings).viewer);
  }, [device?.id, device?.settings]);

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
          <div className="flex items-center gap-2">
            <Badge tone="brand" className="font-mono">
              X {Math.round(position.x)} · Y {Math.round(position.y)} · Z {Math.round(position.z)}
            </Badge>
            <Button
              size="sm"
              icon={<SlidersHorizontal className="size-4" />}
              onClick={() => setPanelOpen((open) => !open)}
            >
              Görünüm
            </Button>
          </div>
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
                  // Yatağı ekrana dolduracak mesafe: yarım genişlik / tan(fov/2).
                  // `zoom` bunu ölçekliyor — küçük değer yakınlaştırıyor.
                  position: [
                    (device.bed_width_mm * MM) / 2,
                    2.4 * viewer.zoom,
                    (device.bed_length_mm * MM + 2.0) * viewer.zoom,
                  ],
                  fov: 45,
                }}
                dpr={[1, 2]}
              >
                <Scene
                  device={device}
                  points={points ?? []}
                  position={position}
                  viewer={viewer}
                />
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

          {device && panelOpen && (
            <ViewerControls
              device={device}
              viewer={viewer}
              onChange={setViewer}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Görünüm ayarları paneli.
 *
 * Robotun gövde ölçüsü, kamera uzaklığı ve etiket boyutu makineden makineye
 * çok değişiyor: 800 mm'lik bir masa modeliyle 4,5 metrelik bir sera aynı
 * varsayılanlarla iyi görünmüyor. Değerler cihazla birlikte saklanıyor.
 */
function ViewerControls({
  device,
  viewer,
  onChange,
  onClose,
}: {
  device: Device;
  viewer: ViewerConfig;
  onChange: (next: ViewerConfig) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, { settings: { ...device.settings, viewer } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Görünüm ayarları kaydedildi");
      onClose();
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <div className="absolute right-4 top-4 w-64 rounded-2xl border border-line glass p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-content">Görünüm</p>
        <button
          onClick={() => onChange(VIEWER_DEFAULTS)}
          aria-label="Varsayılana dön"
          title="Varsayılana dön"
          className="rounded-lg p-1.5 text-subtle transition-soft hover:text-brand"
        >
          <RotateCcw className="size-4" />
        </button>
      </div>

      <div className="space-y-3">
        <Slider
          label="Robot boyutu"
          value={viewer.robot_scale}
          min={0.2}
          max={4}
          onChange={(robot_scale) => onChange({ ...viewer, robot_scale })}
        />
        <Slider
          label="Yakınlaştırma"
          value={viewer.zoom}
          min={0.3}
          max={3}
          onChange={(zoom) => onChange({ ...viewer, zoom })}
        />
        <Slider
          label="Yazı boyutu"
          value={viewer.font_scale}
          min={0.5}
          max={3}
          onChange={(font_scale) => onChange({ ...viewer, font_scale })}
        />

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Izgara</span>
          <Toggle
            checked={viewer.show_grid}
            onChange={(show_grid) => onChange({ ...viewer, show_grid })}
            label="Izgara"
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Etiketler</span>
          <Toggle
            checked={viewer.show_labels}
            onChange={(show_labels) => onChange({ ...viewer, show_labels })}
            label="Etiketler"
          />
        </div>

        <Button
          variant="primary"
          size="sm"
          fullWidth
          icon={<Save className="size-4" />}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Kaydet
        </Button>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-subtle">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--brand)]"
      />
    </label>
  );
}

// --------------------------------------------------------------------------- //

function Scene({
  device,
  points,
  position,
  viewer,
}: {
  device: Device;
  points: Point[];
  position: { x: number; y: number; z: number };
  viewer: ViewerConfig;
}) {
  const width = device.bed_width_mm * MM;
  const length = device.bed_length_mm * MM;
  // Portal yüksekliği artık sabit değil: Z ekseninin gerçek stroku kadar,
  // en az 0.6 m. Sabit 1 m, 4.5 metrelik bir yatakta oyuncak gibi duruyordu.
  const height = Math.max(0.6, device.max_z_mm * MM) * viewer.robot_scale;
  // Kiriş/sütun kalınlıkları da yatakla birlikte büyüsün
  const beam = 0.1 * viewer.robot_scale;

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
      {viewer.show_grid && (
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
      )}

      {/* Yan raylar */}
      <Rail x={width / 2} z={0} length={width} thickness={beam * 0.8} />
      <Rail x={width / 2} z={length} length={width} thickness={beam * 0.8} />

      {/* Hareketli robot */}
      <RobotRig
        length={length}
        height={height}
        beam={beam}
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
          fontScale={viewer.font_scale}
          showLabel={viewer.show_labels}
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
function Rail({
  x,
  z,
  length,
  thickness,
}: {
  x: number;
  z: number;
  length: number;
  thickness: number;
}) {
  return (
    <mesh position={[x, thickness / 2, z]} castShadow receiveShadow>
      <boxGeometry args={[length, thickness, thickness]} />
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
  beam,
  target,
}: {
  length: number;
  height: number;
  beam: number;
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
        <boxGeometry args={[beam, height, beam * 1.2]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, height / 2, length]} castShadow>
        <boxGeometry args={[beam, height, beam * 1.2]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Üst çapraz kiriş */}
      <mesh position={[0, height, length / 2]} castShadow>
        <boxGeometry args={[beam, beam, length + beam * 2]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Çapraz kızak (Y ekseni) */}
      <group ref={carriage}>
        <mesh position={[0, height, 0]} castShadow>
          <boxGeometry args={[beam * 2.2, beam * 1.8, beam * 2.2]} />
          <meshStandardMaterial color="#34d399" metalness={0.35} roughness={0.35} />
        </mesh>

        {/* Z ekseni kolonu ve alet başlığı */}
        <group ref={zAxis}>
          <mesh position={[0, height - height * 0.3, 0]} castShadow>
            <boxGeometry args={[beam * 0.7, height * 0.6, beam * 0.7]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, height - height * 0.62, 0]} castShadow>
            <cylinderGeometry args={[beam * 0.5, beam * 0.35, beam * 1.2, 16]} />
            <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.35} />
          </mesh>
        </group>
      </group>

      {/* X eksenindeki konumu zeminde gösteren iz */}
      <mesh position={[0, 0.001, length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[beam * 0.2, length]} />
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
  fontScale,
  showLabel,
}: {
  x: number;
  z: number;
  radius: number;
  color: string;
  label: string;
  fontScale: number;
  showLabel: boolean;
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
      {/* Yakınlaşınca okunabilen etiket.
          `distanceFactor` büyüdükçe yazı da büyür; kullanıcının yazı boyutu
          tercihi doğrudan buraya çarpan olarak giriyor. */}
      {showLabel && (
        <Html
          position={[0, radius * 1.4, 0]}
          center
          distanceFactor={9 * fontScale}
          className="pointer-events-none select-none whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
        >
          {label}
        </Html>
      )}
    </group>
  );
}
