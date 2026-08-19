/**
 * Robotun gerçek zamanlı 3B dijital ikizi.
 *
 * Sahne birimi metredir; veriler milimetre geldiği için /1000 ile ölçeklenir.
 * Gantry X ekseninde, çapraz kızak Y ekseninde, alet başlığı Z ekseninde
 * robotun canlı konumuna göre hareket eder.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Info, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import type { Group } from "three";

import { Badge, Button, Card, PageHeader, Spinner, Toggle } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { growthAt } from "@/lib/growth";
import { readMachineConfig, VIEWER_DEFAULTS, type ViewerConfig } from "@/lib/machine";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useServerForm } from "@/hooks/useServerForm";
import { useBot } from "@/store/useBot";
import type { Curve, Device, Point } from "@/lib/types";

/**
 * Bakış köşeleri.
 *
 * `sx`/`sz`: kameranın yatak merkezine göre hangi tarafta durduğu. Bu ikili,
 * ekrandaki sağ yönün dünya eksenleriyle nasıl hizalandığını belirliyor —
 * yani sıfır noktasının solda mı sağda mı göründüğünü.
 */
export const CAMERA_ANGLES = {
  on: { label: "Önden", sx: 0.35, sz: 1 },
  sag: { label: "Sağdan", sx: 1, sz: 0.35 },
  arka: { label: "Arkadan", sx: -0.35, sz: -1 },
  sol: { label: "Soldan", sx: -1, sz: -0.35 },
} as const;

export type CameraAngle = keyof typeof CAMERA_ANGLES;

/**
 * Kameranın konumu — yatak merkezinden seçilen yöne doğru geri çekiliyor.
 *
 * Yön adları makinenin çevresindeki dört tarafı anlatıyor; önceki adlandırma
 * ("sıfır ön solda" gibi) koordinat sistemini tarif ediyordu ve makinenin
 * yanında durup bakan biri için anlaşılır değildi.
 */
function cameraPosition(
  travel: { x: number; y: number; z: number },
  viewer: ViewerConfig,
): [number, number, number] {
  const angle =
    CAMERA_ANGLES[(viewer.camera_angle as CameraAngle)] ?? CAMERA_ANGLES.on;
  const reach = Math.max(travel.x, travel.y) * 1.6 * viewer.zoom;
  return [
    travel.x / 2 + angle.sx * reach,
    (LEG_HEIGHT + travel.z * 0.6) * viewer.zoom,
    travel.y / 2 + angle.sz * reach,
  ];
}

/**
 * Bakış açısını kameraya gerçekten uygular.
 *
 * Çözdüğü hata: `<Canvas camera={...}>` prop'u yalnızca **ilk kurulumda**
 * okunuyor. Sonradan değişmesi kamerayı kımıldatmıyor — bu yüzden açı
 * düğmeleri ve yakınlaştırma kaydırıcısı ayarı kaydediyor ama sahnede hiçbir
 * şey olmuyordu.
 *
 * Kamerayı burada elle konumlandırıyoruz. `OrbitControls` kendi durumunu
 * tuttuğu için onun hedefini de güncelleyip `update()` çağırmak şart; yoksa
 * kontrol bir sonraki karede kamerayı eski yerine geri çekiyor.
 */
function CameraRig({
  travel,
  viewer,
  target,
}: {
  travel: { x: number; y: number; z: number };
  viewer: ViewerConfig;
  target: [number, number, number];
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | { target: { set: (x: number, y: number, z: number) => void }; update: () => void }
    | null;

  useEffect(() => {
    const [x, y, z] = cameraPosition(travel, viewer);
    camera.position.set(x, y, z);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    }
  }, [
    camera,
    controls,
    viewer.camera_angle,
    viewer.zoom,
    travel.x,
    travel.y,
    travel.z,
    target[0],
    target[1],
    target[2],
  ]);

  return null;
}

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
  const [viewer, setViewer] = useServerForm<ViewerConfig>(stored.viewer);

  const { data: points } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const position = status?.position ?? { x: 0, y: 0, z: 0 };
  // Takılı uç Gantry Studio'nun durum yanıtından geliyor
  const tool = (status?.informational?.current_tool as string | undefined) ?? null;

  /**
   * Makinenin gerçek strok ölçüleri (m).
   *
   * Önce kalibrasyondaki `max_mm` değerlerine bakıyoruz; sahadaki makine
   * X 425 · Y 450 · Z 550 mm. "Çalışma alanı" ayarı bahçenin ekilebilir
   * ölçüsü, robotun gidebildiği mesafe değil — 3B gövdeyi ondan türetmek
   * oranları bozuyordu. Kalibrasyon boşsa yatak ölçüsüne düşüyoruz.
   */
  const travel = useMemo(() => {
    const axes = stored.axes;
    return {
      x: (axes.x.max_mm ?? device?.bed_width_mm ?? 1000) * MM,
      y: (axes.y.max_mm ?? device?.bed_length_mm ?? 1000) * MM,
      z: (axes.z.max_mm ?? device?.max_z_mm ?? 400) * MM,
    };
  }, [stored.axes, device?.bed_width_mm, device?.bed_length_mm, device?.max_z_mm]);

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
                  /*
                   * Bakış köşesi kullanıcının tercihi.
                   *
                   * Hangi köşeden bakıldığı, makinenin sıfır noktasının ekranda
                   * sağda mı solda mı göründüğünü belirliyor ve bu kişiden
                   * kişiye değişen bir beklenti. Sabit bir açı seçip tahmin
                   * etmek yerine dört köşeyi de sunuyoruz; varsayılan, sıfır
                   * noktasının ön solda kaldığı açı.
                   */
                  position: cameraPosition(travel, viewer),
                  fov: 45,
                }}
                dpr={[1, 2]}
              >
                <Scene
                  points={points ?? []}
                  position={position}
                  viewer={viewer}
                  travel={travel}
                  tool={tool}
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
        {/* Bakış köşesi — sıfır noktasının ekranda nerede kalacağını belirler */}
        <div>
          <p className="mb-1.5 text-xs text-muted">Bakış açısı</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(CAMERA_ANGLES) as CameraAngle[]).map((key) => (
              <button
                key={key}
                onClick={() => onChange({ ...viewer, camera_angle: key })}
                className={
                  viewer.camera_angle === key
                    ? "rounded-lg border border-transparent bg-gradient-brand px-2 py-1.5 text-[0.7rem] font-semibold text-white"
                    : "rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[0.7rem] text-muted transition-soft hover:text-content"
                }
              >
                {CAMERA_ANGLES[key].label}
              </button>
            ))}
          </div>
        </div>

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
// Makine gövdesi
//
// Geometri sahadaki gerçek makineden çıkarıldı (montaj fotoğrafı): ahşap yatak
// ya da toprak kasası **yok**. Makine baştan sona alüminyum sigma profilden ve
// dört ayak üzerinde duran açık bir tezgâh. Yan raylar tezgâhın üst çerçevesine
// oturuyor, portal bu raylar üzerinde X boyunca kayıyor, araba üstteki kirişte
// Y boyunca gidiyor, Z kolonu arabanın içinden geçip kirişin üstüne uzanıyor.
// --------------------------------------------------------------------------- //

/** Sigma profilin kenar ölçüsü (m). Sahadaki profil 20 mm. */
const PROFILE = 0.02;
/** Tezgâh ayak yüksekliği (m). */
const LEG_HEIGHT = 0.62;

const ALUMINIUM = { color: "#c9ced6", metalness: 0.85, roughness: 0.32 } as const;
const DARK_PART = { color: "#2a2f38", metalness: 0.5, roughness: 0.55 } as const;

/**
 * Alüminyum sigma profil parçası.
 *
 * T-kanalı için doku kullanmıyoruz: doku dosyası indirmek gerekir, uygulama ise
 * internetsiz yerel ağda da çalışmalı. Bunun yerine profilin ortasına ince koyu
 * bir şerit koyuyoruz — normal bakış mesafesinde kanal izlenimini doku maliyeti
 * olmadan veriyor.
 */
function Extrusion({
  size,
  position,
  slot = true,
}: {
  size: [number, number, number];
  position: [number, number, number];
  slot?: boolean;
}) {
  const [w, h, d] = size;
  // Kanal çizgisi parçanın en uzun ekseni boyunca uzanmalı
  const longest = Math.max(w, h, d);
  const groove: [number, number, number] =
    longest === w
      ? [w * 0.98, h * 0.22, d * 1.01]
      : longest === h
        ? [w * 1.01, h * 0.98, d * 0.22]
        : [w * 0.22, h * 1.01, d * 0.98];

  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...ALUMINIUM} />
      </mesh>
      {slot && (
        <mesh>
          <boxGeometry args={groove} />
          <meshStandardMaterial color="#8f959f" metalness={0.7} roughness={0.6} />
        </mesh>
      )}
    </group>
  );
}

/** Köşe bağlantı braketi — fotoğraftaki siyah parçalar. */
function Bracket({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} castShadow>
      <boxGeometry args={[PROFILE * 3, PROFILE * 0.5, PROFILE * 3]} />
      <meshStandardMaterial {...DARK_PART} />
    </mesh>
  );
}

/** Step motor gövdesi ve mili. */
function Motor({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[PROFILE * 2.1, PROFILE * 2.1, PROFILE * 2.4]} />
        <meshStandardMaterial color="#1c2027" metalness={0.45} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, PROFILE * 1.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[PROFILE * 0.15, PROFILE * 0.15, PROFILE * 0.7, 12]} />
        <meshStandardMaterial color="#9aa1ab" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
}

/** V-tekerlek — arabaların profil üzerinde yürüdüğü siyah makaralar. */
function VWheel({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[PROFILE * 0.6, PROFILE * 0.6, PROFILE * 0.5, 16]} />
      <meshStandardMaterial color="#15181d" metalness={0.3} roughness={0.7} />
    </mesh>
  );
}

/** Dört ayaklı tezgâh: bacaklar, ayak pabuçları ve üst çerçeve. */
function Bench({
  width,
  length,
  height,
}: {
  width: number;
  length: number;
  height: number;
}) {
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [0, length],
    [width, length],
  ];

  return (
    <group>
      {corners.map(([x, z], index) => (
        <group key={index}>
          <Extrusion size={[PROFILE, height, PROFILE]} position={[x, height / 2, z]} />
          {/* Ayarlanabilir ayak pabucu */}
          <mesh position={[x, 0.006, z]} castShadow>
            <cylinderGeometry args={[PROFILE * 0.7, PROFILE * 0.7, 0.012, 12]} />
            <meshStandardMaterial {...DARK_PART} />
          </mesh>
        </group>
      ))}

      {/* Üst çerçevenin dört kenarı */}
      <Extrusion size={[width, PROFILE, PROFILE]} position={[width / 2, height, 0]} />
      <Extrusion size={[width, PROFILE, PROFILE]} position={[width / 2, height, length]} />
      <Extrusion size={[PROFILE, PROFILE, length]} position={[0, height, length / 2]} />
      <Extrusion size={[PROFILE, PROFILE, length]} position={[width, height, length / 2]} />

      {corners.map(([x, z], index) => (
        <Bracket key={index} position={[x, height - PROFILE * 0.75, z]} />
      ))}
    </group>
  );
}

/**
 * Toprak kabı — çerçevenin içine oturan plastik saklama kabı.
 *
 * Sahada tezgâhın içine saklama kapları konup toprakla dolduruluyor; makine
 * bitkileri bu kapların üstünden ekiyor. Daha önce çerçevenin içi boştu ve
 * bitkiler havada duruyor gibi görünüyordu.
 *
 * Kap kenarları yarı saydam: fotoğraftaki kaplar şeffaf plastik ve toprağın
 * yan duvardan görünmesi derinlik hissini veriyor.
 */
function SoilBin({
  width,
  length,
  top,
  depth,
}: {
  width: number;
  length: number;
  /** Kabın ağız hizası (m) */
  top: number;
  /** Kabın derinliği (m) */
  depth: number;
}) {
  const wall = 0.005;
  // Kap, çerçevenin içine biraz boşluk bırakarak oturuyor
  const inset = PROFILE * 1.2;
  const w = width - inset * 2;
  const l = length - inset * 2;
  const cx = width / 2;
  const cz = length / 2;
  const midY = top - depth / 2;

  // Toprak yüzeyi kabın ağzından biraz aşağıda
  const soilY = top - depth * 0.22;

  /** Toprağı düz bir levha gibi göstermemek için serpiştirilmiş küçük kümeler. */
  const clumps = useMemo(() => {
    const list: { x: number; z: number; r: number }[] = [];
    // Sabit bir örüntü: her karede yeniden üretilirse toprak titrer
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 26; i++) {
      list.push({
        x: (rand() - 0.5) * w * 0.92,
        z: (rand() - 0.5) * l * 0.92,
        r: 0.004 + rand() * 0.006,
      });
    }
    return list;
  }, [w, l]);

  return (
    <group position={[cx, 0, cz]}>
      {/* Kap tabanı */}
      <mesh position={[0, top - depth, 0]} receiveShadow>
        <boxGeometry args={[w, wall, l]} />
        <meshStandardMaterial color="#6b7280" roughness={0.7} />
      </mesh>

      {/* Dört yan duvar — yarı saydam plastik */}
      {[
        { p: [0, midY, -l / 2] as const, s: [w, depth, wall] as const },
        { p: [0, midY, l / 2] as const, s: [w, depth, wall] as const },
        { p: [-w / 2, midY, 0] as const, s: [wall, depth, l] as const },
        { p: [w / 2, midY, 0] as const, s: [wall, depth, l] as const },
      ].map((wallSpec, index) => (
        <mesh key={index} position={wallSpec.p} castShadow>
          <boxGeometry args={wallSpec.s} />
          <meshStandardMaterial
            color="#9ca3af"
            transparent
            opacity={0.35}
            roughness={0.25}
            metalness={0.05}
          />
        </mesh>
      ))}

      {/* Toprak dolgusu */}
      <mesh position={[0, (soilY + (top - depth)) / 2, 0]} receiveShadow>
        <boxGeometry args={[w - wall * 2, soilY - (top - depth), l - wall * 2]} />
        <meshStandardMaterial color="#4a3220" roughness={1} />
      </mesh>

      {/* Yüzey kümeleri — toprağın düz levha gibi durmasını engelliyor */}
      {clumps.map((c, index) => (
        <mesh key={index} position={[c.x, soilY, c.z]} receiveShadow castShadow>
          <sphereGeometry args={[c.r, 6, 4]} />
          <meshStandardMaterial color="#5a3d27" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

const TOOL_LENGTH = 0.12;

/**
 * Değiştirilebilir uç.
 *
 * Makinede tek bir alet yok: sulama ucu, tohum alma ucu, toprak sensörü…
 * Hepsi aynı hızlı bağlantıya takılıyor, yalnızca uç kısmı değişiyor. Burada
 * da gövde ortak, uç `kind`'e göre farklı çiziliyor.
 *
 * Hangi ucun takılı olduğu Gantry Studio'nun durum yanıtındaki `current_tool`
 * alanından geliyor; tanımadığımız bir isimde genel uç gösteriliyor.
 */
function ToolHead({ kind }: { kind: string | null }) {
  const label = (kind ?? "").toLocaleLowerCase("tr");
  const type = label.includes("sula") || label.includes("water")
    ? "water"
    : label.includes("tohum") || label.includes("seed") || label.includes("ek")
      ? "seed"
      : label.includes("toprak") || label.includes("soil") || label.includes("sensör")
        ? "soil"
        : "generic";

  const tint =
    type === "water" ? "#38bdf8" : type === "seed" ? "#f59e0b" : type === "soil" ? "#22c55e" : "#94a3b8";

  return (
    <group>
      {/* Hızlı bağlantı gövdesi — her uçta ortak */}
      <mesh castShadow>
        <boxGeometry args={[PROFILE * 1.8, PROFILE * 2.2, PROFILE * 1.8]} />
        <meshStandardMaterial {...DARK_PART} />
      </mesh>
      {/* Kilitleme bileziği */}
      <mesh position={[0, -PROFILE * 1.3, 0]} castShadow>
        <cylinderGeometry args={[PROFILE * 0.85, PROFILE * 0.85, PROFILE * 0.5, 16]} />
        <meshStandardMaterial color="#6b7280" metalness={0.75} roughness={0.3} />
      </mesh>

      {type === "water" && (
        <>
          {/* Sulama ucu: gövde + geniş ağızlı meme */}
          <mesh position={[0, -PROFILE * 2.4, 0]} castShadow>
            <cylinderGeometry args={[PROFILE * 0.5, PROFILE * 0.5, PROFILE * 1.8, 16]} />
            <meshStandardMaterial color={tint} roughness={0.35} metalness={0.15} />
          </mesh>
          <mesh position={[0, -PROFILE * 3.5, 0]} castShadow>
            <coneGeometry args={[PROFILE * 0.9, PROFILE * 0.9, 18, 1, true]} />
            <meshStandardMaterial color={tint} roughness={0.3} metalness={0.2} side={2} />
          </mesh>
          {/* Hortum bağlantısı */}
          <mesh position={[PROFILE * 0.9, -PROFILE * 1.9, 0]} rotation={[0, 0, Math.PI / 2.4]} castShadow>
            <cylinderGeometry args={[PROFILE * 0.28, PROFILE * 0.28, PROFILE * 1.6, 10]} />
            <meshStandardMaterial color="#1f2937" roughness={0.85} />
          </mesh>
        </>
      )}

      {type === "seed" && (
        <>
          {/* Tohum alma ucu: ince vakum borusu */}
          <mesh position={[0, -PROFILE * 2.6, 0]} castShadow>
            <cylinderGeometry args={[PROFILE * 0.3, PROFILE * 0.3, PROFILE * 2.2, 12]} />
            <meshStandardMaterial color={tint} roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh position={[0, -PROFILE * 3.9, 0]} castShadow>
            <cylinderGeometry args={[PROFILE * 0.12, PROFILE * 0.12, PROFILE * 0.8, 10]} />
            <meshStandardMaterial color="#e5e7eb" metalness={0.6} roughness={0.3} />
          </mesh>
        </>
      )}

      {type === "soil" && (
        <>
          {/* Toprak sensörü: iki çatal prob */}
          {[-PROFILE * 0.35, PROFILE * 0.35].map((dx, index) => (
            <mesh key={index} position={[dx, -PROFILE * 3, 0]} castShadow>
              <cylinderGeometry args={[PROFILE * 0.1, PROFILE * 0.06, PROFILE * 3, 8]} />
              <meshStandardMaterial color={tint} metalness={0.7} roughness={0.3} />
            </mesh>
          ))}
        </>
      )}

      {type === "generic" && (
        <mesh position={[0, -PROFILE * 2.6, 0]} castShadow>
          <cylinderGeometry args={[PROFILE * 0.5, PROFILE * 0.28, PROFILE * 2.2, 16]} />
          <meshStandardMaterial color={tint} metalness={0.5} roughness={0.4} />
        </mesh>
      )}

      {/* Uç ucundaki gösterge — konumu gözle takip etmeyi kolaylaştırıyor */}
      <mesh position={[0, -PROFILE * 4.4, 0]}>
        <sphereGeometry args={[PROFILE * 0.22, 10, 8]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.55} />
      </mesh>
    </group>
  );
}

function Scene({
  points,
  position,
  viewer,
  travel,
  tool,
}: {
  points: Point[];
  position: { x: number; y: number; z: number };
  viewer: ViewerConfig;
  travel: { x: number; y: number; z: number };
  /** Takılı ucun adı — uç geometrisi buna göre değişiyor. */
  tool: string | null;
}) {
  const width = travel.x;
  const length = travel.y;
  const benchHeight = LEG_HEIGHT * viewer.robot_scale;

  const zTravel = Math.max(0.25, travel.z) * viewer.robot_scale;

  // Toprak kabı çerçevenin içine oturuyor; bitkiler tezgâh düzleminde değil,
  // toprağın yüzeyinde bitiyor.
  const binDepth = Math.min(0.18, Math.max(0.08, Math.min(width, length) * 0.35));
  const soilY = benchHeight - binDepth * 0.22;

  /*
   * Kirişin yüksekliği tahminle değil, **fiziksel kısıttan** türetiliyor:
   * uç, Z tamamen inikken toprağa tam değmeli.
   *
   *   uç dinlenme hizası = toprak + Z stroğu      (Z sıfırdayken en üstte)
   *   kiriş              = uç dinlenme + alet boyu + araba payı
   *
   * Önceki hesap kirişi doğrudan Z stroğuna eşitliyordu; aletin kendi boyunu
   * saymadığı için makine hem kısa duruyordu hem de uç toprağa 33 mm
   * yetişemiyordu.
   */
  const toolRestY = soilY + zTravel;
  const beamY = toolRestY + TOOL_LENGTH + PROFILE * 3;
  const portal = beamY - benchHeight;

  const plants = useMemo(
    () => points.filter((p) => p.point_type === "plant" && p.species),
    [points],
  );

  // Olgunluk hesabı tasarımcıyla aynı yerden gelsin: iki ayrı formül tutarsız
  // görünüm üretirdi (kuşbakışında meyveli, 3B'de filiz gibi).
  const now = useMemo(() => new Date(), []);
  const curveMap = useMemo(() => new Map<string, Curve>(), []);

  return (
    <>
      {/*
        Aydınlatma tamamen yerel: drei'nin Environment bileşeni HDRI dosyasını
        dış bir CDN'den indirir. Bu uygulama çiftlikte, internetsiz bir yerel
        ağda da çalışabilmeli — bu yüzden ışıkları elle kuruyoruz.
      */}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#cfe6ff", "#3a3a3a", 0.75]} />
      <directionalLight
        position={[width + 1, benchHeight + portal + 1.5, length + 1]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-1.5, 2, -1.5]} intensity={0.35} />

      {/* Zemin — makine toprak kasasında değil, atölye zemininde duruyor */}
      <mesh position={[width / 2, 0, length / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 3, length + 3]} />
        <meshStandardMaterial color="#3f4650" roughness={0.95} />
      </mesh>

      {viewer.show_grid && (
        <Grid
          position={[width / 2, 0.002, length / 2]}
          args={[width + 2, length + 2]}
          cellSize={0.1}
          cellColor="#4b5563"
          sectionSize={0.5}
          sectionColor="#6b7280"
          fadeDistance={18}
          infiniteGrid={false}
        />
      )}

      <CameraRig
        travel={travel}
        viewer={viewer}
        target={[width / 2, soilY, length / 2]}
      />

      <Bench width={width} length={length} height={benchHeight} />

      {/* Toprak dolu saklama kabı — çerçevenin içi artık boş değil */}
      <SoilBin width={width} length={length} top={benchHeight} depth={binDepth} />

      <RobotRig
        width={width}
        length={length}
        benchHeight={benchHeight}
        portal={portal}
        toolRestY={toolRestY}
        zTravel={zTravel}
        tool={tool}
        target={{ x: position.x * MM, y: position.y * MM, z: position.z * MM }}
      />

      {/* Bitkiler tezgâh düzleminde duruyor */}
      {plants.map((plant) => (
        <Plant3D
          key={plant.id}
          x={plant.x * MM}
          z={plant.y * MM}
          base={soilY}
          radius={Math.max(0.02, plant.radius_mm * MM)}
          species={plant.species!}
          progress={growthAt(plant, now, curveMap).maturity}
          fontScale={viewer.font_scale}
          showLabel={viewer.show_labels}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[width / 2, soilY, length / 2]}
        enableDamping
        maxPolarAngle={Math.PI / 2.05}
        minDistance={0.6}
        maxDistance={12}
      />
    </>
  );
}

/**
 * Portal + araba + Z kolonu.
 * Konum, ani sıçrama yerine yumuşak geçişle hedefe yaklaşır.
 */
function RobotRig({
  width,
  length,
  benchHeight,
  portal,
  toolRestY,
  zTravel,
  tool,
  target,
}: {
  width: number;
  length: number;
  benchHeight: number;
  portal: number;
  /** Z sıfırdayken ucun bağlantı hizası (m) */
  toolRestY: number;
  /** Z ekseninin toplam stroğu (m) */
  zTravel: number;
  tool: string | null;
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
      // Z aşağı iniyor; kolonun üst ucu aynı anda kirişin üstünde yükseliyor.
      // İniş strokla sınırlı: sınır dışı bir değer gelse bile uç kabın
      // altından geçip görüntüyü bozmasın.
      const desired = -Math.min(Math.abs(target.z), zTravel);
      zAxis.current.position.y += (desired - zAxis.current.position.y) * SMOOTHING;
    }
  });

  const beamY = benchHeight + portal;

  return (
    <>
      {/* Yan raylar — portalın üzerinde yürüdüğü profiller */}
      {[0, length].map((z) => (
        <Extrusion
          key={z}
          size={[width, PROFILE, PROFILE * 2]}
          position={[width / 2, benchHeight + PROFILE, z]}
        />
      ))}

      <group ref={gantry}>
        {[0, length].map((z) => (
          <group key={z}>
            {/* Dikey sütun */}
            <Extrusion
              size={[PROFILE, portal, PROFILE]}
              position={[0, benchHeight + portal / 2, z]}
            />
            {/* Sütunu taşıyıcıya bağlayan çapraz destek */}
            <mesh
              position={[PROFILE * 1.4, benchHeight + portal * 0.18, z]}
              rotation={[0, 0, -Math.PI / 4]}
              castShadow
            >
              <boxGeometry args={[PROFILE * 3.2, PROFILE * 0.4, PROFILE * 1.2]} />
              <meshStandardMaterial {...DARK_PART} />
            </mesh>
            {/* Ray üzerindeki taşıyıcı ve tekerlekleri */}
            <mesh position={[0, benchHeight + PROFILE * 1.6, z]} castShadow>
              <boxGeometry args={[PROFILE * 3.4, PROFILE * 1.4, PROFILE * 1.6]} />
              <meshStandardMaterial {...DARK_PART} />
            </mesh>
            <VWheel position={[-PROFILE * 1.1, benchHeight + PROFILE * 1.6, z + PROFILE * 0.9]} />
            <VWheel position={[PROFILE * 1.1, benchHeight + PROFILE * 1.6, z + PROFILE * 0.9]} />
          </group>
        ))}

        {/* Üst çapraz kiriş */}
        <Extrusion
          size={[PROFILE, PROFILE * 2, length + PROFILE * 2]}
          position={[0, beamY, length / 2]}
        />

        {/* Kirişin ucundaki Y motoru */}
        <Motor position={[0, beamY, -PROFILE * 2.2]} />

        <group ref={carriage}>
          {/* Y arabası */}
          <mesh position={[0, beamY, 0]} castShadow>
            <boxGeometry args={[PROFILE * 2.2, PROFILE * 3, PROFILE * 2.6]} />
            <meshStandardMaterial {...DARK_PART} />
          </mesh>
          <VWheel position={[PROFILE * 1.3, beamY + PROFILE * 0.9, 0]} />
          <VWheel position={[PROFILE * 1.3, beamY - PROFILE * 0.9, 0]} />

          {/*
            Z takımı — sahadaki düzen (fotoğraf): arabaya sabit bir motor
            bloğu, ondan aşağı inen **vidalı mil**, milin yanında kılavuz
            profil ve profile bağlı hareketli taşıyıcı. Önceki sürümde Z tek
            ince çubuktu ve kirişin çok üstüne uzanıyordu; çerçeve genişliğinin
            3 katı boyunda dev bir direk gibi duruyordu.
          */}

          {/* Motor bloğu arabaya sabit — Z inip çıkarken yerinde kalır */}
          <mesh position={[PROFILE * 1.7, beamY - PROFILE * 0.6, 0]} castShadow>
            <boxGeometry args={[PROFILE * 2.6, PROFILE * 3.4, PROFILE * 2.4]} />
            <meshStandardMaterial {...DARK_PART} />
          </mesh>
          <Motor position={[PROFILE * 1.7, beamY + PROFILE * 1.9, 0]} rotation={[Math.PI / 2, 0, 0]} />

          <group ref={zAxis}>
            {/* Kılavuz profil — Z stroğu kadar, artı araba payı */}
            <Extrusion
              size={[PROFILE, zTravel + PROFILE * 6, PROFILE]}
              position={[PROFILE * 1.7, toolRestY + zTravel / 2, 0]}
            />
            {/* Vidalı mil, profilin hemen yanında */}
            <mesh
              position={[PROFILE * 0.5, toolRestY + zTravel / 2, 0]}
              castShadow
            >
              <cylinderGeometry
                args={[PROFILE * 0.16, PROFILE * 0.16, zTravel + PROFILE * 7, 10]}
              />
              <meshStandardMaterial color="#aab1ba" metalness={0.9} roughness={0.28} />
            </mesh>
            {/* Milin üst ucundaki rulman yuvası */}
            <mesh position={[PROFILE * 0.5, toolRestY + zTravel + PROFILE * 3.4, 0]} castShadow>
              <cylinderGeometry args={[PROFILE * 0.45, PROFILE * 0.45, PROFILE * 0.8, 12]} />
              <meshStandardMaterial {...DARK_PART} />
            </mesh>
            {/* Profilin alt ucundaki alet taşıyıcı */}
            <mesh position={[PROFILE * 1.1, toolRestY + PROFILE * 1.4, 0]} castShadow>
              <boxGeometry args={[PROFILE * 2.4, PROFILE * 2, PROFILE * 1.8]} />
              <meshStandardMaterial {...DARK_PART} />
            </mesh>

            <group position={[PROFILE * 1.1, toolRestY, 0]}>
              <ToolHead kind={tool} />
            </group>
          </group>
        </group>
      </group>
    </>
  );
}

// --------------------------------------------------------------------------- //
// Bitkiler
// --------------------------------------------------------------------------- //

/**
 * Prosedürel bitki: filizden meyveye.
 *
 * Neden tür başına çizim yok: katalog büyüdükçe her yeni sebze için model
 * hazırlamak gerekirdi. Burada gövde, yapraklar ve meyveler olgunluk oranıyla
 * ölçekleniyor; renk türün kendi renginden geliyor. Yeni bir tür eklendiğinde
 * hiçbir şey yapmadan çalışıyor.
 *
 * Aşamalar:
 *   0.00 – 0.15  toprakta tohum, henüz görünür bir şey yok
 *   0.15 – 0.55  filiz: kısa gövde, açılan yapraklar
 *   0.55 – 1.00  meyvelenme: yapraklar tam boy, meyveler belirip büyüyor
 */
function Plant3D({
  x,
  z,
  base,
  radius,
  species,
  progress,
  fontScale,
  showLabel,
}: {
  x: number;
  z: number;
  base: number;
  radius: number;
  species: { name_tr: string; color: string; icon: string };
  progress: number;
  fontScale: number;
  showLabel: boolean;
}) {
  const sprouted = Math.max(0, (progress - 0.12) / 0.88);
  const height = radius * (0.4 + sprouted * 1.6);
  const leafSize = radius * (0.25 + sprouted * 0.75);

  // Meyveler olgunluğun ikinci yarısında beliriyor
  const fruiting = Math.max(0, (progress - 0.55) / 0.45);
  const fruitRadius = radius * 0.3 * fruiting;

  const leaves = useMemo(
    () => [0, 1, 2, 3, 4].map((i) => (i / 5) * Math.PI * 2),
    [],
  );

  return (
    <group position={[x, base, z]}>
      {/* Ekim noktası — bitki görünmeden önce de yerini belli etsin */}
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.35, 20]} />
        <meshStandardMaterial color="#4a3728" roughness={1} />
      </mesh>

      {/* Yayılma halkası */}
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.92, radius, 40]} />
        <meshBasicMaterial color={species.color} transparent opacity={0.35} />
      </mesh>

      {progress > 0.12 && (
        <>
          {/* Gövde */}
          <mesh position={[0, height / 2, 0]} castShadow>
            <cylinderGeometry args={[radius * 0.05, radius * 0.07, height, 8]} />
            <meshStandardMaterial color="#3f7d3a" roughness={0.8} />
          </mesh>

          {/* Yapraklar — gövdenin çevresine dağılmış */}
          {leaves.map((angle, index) => {
            const tilt = 0.5 + (index % 2) * 0.25;
            return (
              <mesh
                key={index}
                position={[
                  Math.cos(angle) * leafSize * 0.7,
                  height * (0.55 + (index % 3) * 0.12),
                  Math.sin(angle) * leafSize * 0.7,
                ]}
                rotation={[tilt, angle, 0]}
                castShadow
              >
                <sphereGeometry args={[leafSize * 0.55, 10, 6]} />
                <meshStandardMaterial color={species.color} roughness={0.75} flatShading />
              </mesh>
            );
          })}

          {/* Meyveler */}
          {fruiting > 0.02 &&
            leaves.slice(0, 3).map((angle, index) => (
              <mesh
                key={`f-${index}`}
                position={[
                  Math.cos(angle + 0.6) * leafSize * 0.5,
                  height * 0.45,
                  Math.sin(angle + 0.6) * leafSize * 0.5,
                ]}
                castShadow
              >
                <sphereGeometry args={[fruitRadius, 14, 10]} />
                <meshStandardMaterial color={species.color} roughness={0.45} metalness={0.05} />
              </mesh>
            ))}
        </>
      )}

      {showLabel && (
        <Html
          position={[0, height + radius * 0.5, 0]}
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
