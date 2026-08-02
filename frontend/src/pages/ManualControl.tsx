import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Crosshair, Gamepad2, Move3d, Ruler, Zap } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Slider,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { EmergencyStop } from "@/components/control/EmergencyStop";
import { JogPad } from "@/components/control/JogPad";
import { api } from "@/lib/api";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBot } from "@/store/useBot";

export default function ManualControl() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const status = useBot((s) => s.status);
  const [speed, setSpeed] = useState(100);

  const position = status?.position ?? { x: 0, y: 0, z: 0 };
  const axisStates = status?.axis_states ?? {};

  const { data: peripherals } = useQuery({
    queryKey: ["peripherals", deviceId],
    queryFn: () => api.hardware.peripherals(deviceId!),
    enabled: Boolean(deviceId),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manuel Kontrol"
        description="Robotu elle sürün, çevre birimlerini yönetin"
        icon={<Gamepad2 className="size-5" />}
        actions={
          <Badge tone={status?.busy ? "warning" : "success"} dot pulse={status?.busy}>
            {status?.busy ? "Komut çalışıyor" : "Hazır"}
          </Badge>
        }
      />

      {/* Anlık konum */}
      <div className="grid grid-cols-3 gap-3">
        {(["x", "y", "z"] as const).map((axis) => (
          <Card key={axis} className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
              {axis} ekseni
            </p>
            <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-content">
              {Math.round(position[axis])}
            </p>
            <p className="text-xs text-subtle">mm</p>
            <Badge
              tone={axisStates[axis] === "idle" ? "neutral" : "brand"}
              className="mt-2"
            >
              {axisStates[axis] === "idle" ? "durgun" : (axisStates[axis] ?? "—")}
            </Badge>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Yön tuşları */}
          <Card>
            <CardHeader
              title="Yön Kontrolü"
              subtitle="Seçili adım kadar hareket eder"
              icon={<Move3d className="size-4" />}
            />
            <JogPad deviceId={deviceId} speed={speed} />

            <div className="mt-6 border-t border-line pt-5">
              <Slider
                label="Hız"
                unit="%"
                min={10}
                max={100}
                step={5}
                value={speed}
                onChange={setSpeed}
              />
            </div>
          </Card>

          {/* Koordinata git */}
          <GoToCoordinate />
        </div>

        <div className="space-y-6">
          <EmergencyStop />

          {/* Çevre birimleri */}
          <Card>
            <CardHeader
              title="Çevre Birimleri"
              subtitle="Pompa, vana, aydınlatma"
              icon={<Zap className="size-4" />}
            />
            {peripherals?.length ? (
              <ul className="space-y-2.5">
                {peripherals.map((peripheral) => (
                  <PeripheralSwitch
                    key={peripheral.id}
                    deviceId={deviceId}
                    id={peripheral.id}
                    label={peripheral.label}
                    pin={peripheral.pin}
                    icon={peripheral.icon}
                  />
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-subtle">
                Ayarlar'dan çevre birimi ekleyebilirsiniz.
              </p>
            )}
          </Card>

          {/* Kalibrasyon */}
          <Card>
            <CardHeader
              title="Kalibrasyon"
              subtitle="Eksen uzunluklarını ölç"
              icon={<Ruler className="size-4" />}
            />
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "z", "all"] as const).map((axis) => (
                <Button
                  key={axis}
                  size="sm"
                  onClick={async () => {
                    if (!deviceId) return;
                    try {
                      await api.control.calibrate(deviceId, axis);
                      toast.info(
                        axis === "all" ? "Tüm eksenler kalibre ediliyor" : `${axis.toUpperCase()} kalibre ediliyor`,
                      );
                    } catch (error) {
                      toast.error("Kalibrasyon başlatılamadı", (error as Error).message);
                    }
                  }}
                >
                  {axis === "all" ? "Tümü" : `${axis.toUpperCase()} ekseni`}
                </Button>
              ))}
            </div>
            <Button
              className="mt-2"
              fullWidth
              size="sm"
              icon={<Camera className="size-4" />}
              onClick={async () => {
                if (!deviceId) return;
                try {
                  await api.control.takePhoto(deviceId);
                  toast.success("Fotoğraf çekiliyor");
                } catch (error) {
                  toast.error("Fotoğraf çekilemedi", (error as Error).message);
                }
              }}
            >
              Fotoğraf Çek
            </Button>
          </Card>

          {device && (
            <Card>
              <CardHeader title="Çalışma Alanı" icon={<Crosshair className="size-4" />} />
              <dl className="space-y-2 text-sm">
                <Row label="Genişlik (X)" value={`${device.bed_width_mm} mm`} />
                <Row label="Uzunluk (Y)" value={`${device.bed_length_mm} mm`} />
                <Row label="Derinlik (Z)" value={`${device.max_z_mm} mm`} />
                <Row label="Toprak yüzeyi" value={`${device.soil_height_mm} mm`} />
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-content">{value}</dd>
    </div>
  );
}

/** Belirli bir koordinata doğrudan gitme formu. */
function GoToCoordinate() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const [coords, setCoords] = useState({ x: "0", y: "0", z: "0" });
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!deviceId) return;
    const x = Number(coords.x);
    const y = Number(coords.y);
    const z = Number(coords.z);

    if ([x, y, z].some(Number.isNaN)) {
      toast.error("Geçersiz koordinat", "Lütfen sayısal değer girin.");
      return;
    }

    setBusy(true);
    try {
      await api.control.moveAbsolute(deviceId, { x, y, z });
      toast.success("Hedefe gidiliyor", `X ${x} · Y ${y} · Z ${z}`);
    } catch (error) {
      toast.error("Hareket başarısız", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Koordinata Git"
        subtitle="Milimetre cinsinden mutlak konum"
        icon={<Crosshair className="size-4" />}
      />
      <div className="grid grid-cols-3 gap-3">
        <Input
          name="x"
          label="X"
          inputMode="numeric"
          value={coords.x}
          onChange={(e) => setCoords({ ...coords, x: e.target.value })}
          hint={device ? `0 – ${device.bed_width_mm}` : undefined}
        />
        <Input
          name="y"
          label="Y"
          inputMode="numeric"
          value={coords.y}
          onChange={(e) => setCoords({ ...coords, y: e.target.value })}
          hint={device ? `0 – ${device.bed_length_mm}` : undefined}
        />
        <Input
          name="z"
          label="Z"
          inputMode="numeric"
          value={coords.z}
          onChange={(e) => setCoords({ ...coords, z: e.target.value })}
          hint={device ? `-${device.max_z_mm} – 0` : undefined}
        />
      </div>
      <Button variant="primary" className="mt-4" fullWidth loading={busy} onClick={go}>
        Bu Konuma Git
      </Button>
    </Card>
  );
}

/** Bir GPIO çıkışını açıp kapatan anahtar. Pin durumu robotun durum ağacından okunur. */
function PeripheralSwitch({
  deviceId,
  label,
  pin,
  icon,
}: {
  deviceId: string | null;
  id: string;
  label: string;
  pin: number;
  icon: string;
}) {
  const pinState = useBot((s) => s.status?.pins?.[String(pin)]);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  // Robottan gelen gerçek durum, iyimser tahmini geçersiz kılar
  const isOn = optimistic ?? (pinState?.value ?? 0) > 0;

  async function toggle(next: boolean) {
    if (!deviceId) return;
    setOptimistic(next);
    try {
      await api.control.writePin(deviceId, { pin, value: next ? 1 : 0, mode: 0 });
    } catch (error) {
      setOptimistic(null); // geri al
      toast.error(`${label} değiştirilemedi`, (error as Error).message);
      return;
    }
    // Robot durum yayınını gönderince gerçek değere dön
    window.setTimeout(() => setOptimistic(null), 1500);
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="text-base">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-content">{label}</span>
          <span className="font-mono text-xs text-subtle">pin {pin}</span>
        </span>
      </span>
      <Toggle checked={isOn} onChange={toggle} label={label} disabled={!deviceId} />
    </li>
  );
}
