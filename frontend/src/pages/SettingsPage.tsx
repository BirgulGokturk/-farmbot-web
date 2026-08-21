import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Cpu, LogOut, Monitor, Plus, Ruler, Settings, Trash2, User, Zap } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { AgentSetup } from "@/components/settings/AgentSetup";
import { Calibration } from "@/components/settings/Calibration";
import {
  SeederSettings,
  TravelSettings,
} from "@/components/settings/Planting";
import { AlertRules } from "@/components/settings/AlertRules";
import { InstallApp } from "@/components/settings/InstallApp";
import { api } from "@/lib/api";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useAuth } from "@/store/useAuth";
import { useTheme } from "@/store/useTheme";
import type { Device } from "@/lib/types";

export default function SettingsPage() {
  const { data: device } = useActiveDevice();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.set);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ayarlar"
        description="Cihaz, donanım ve hesap yapılandırması"
        icon={<Settings className="size-5" />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {device && <DeviceSettings device={device} />}
        {device && <WorkspaceSettings device={device} />}
        {device && <Calibration device={device} />}
        {device && <TravelSettings device={device} />}
        {device && <SeederSettings device={device} />}
        <AgentSetup />
        <HardwareSettings />
        <InstallApp />
        <AlertRules />

        <div className="space-y-5">
          <Card>
            <CardHeader title="Görünüm" subtitle="Tema tercihi" icon={<Monitor className="size-4" />} />
            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-content">Karanlık mod</p>
                <p className="text-xs text-subtle">Gece kullanımda gözü yormaz</p>
              </div>
              <Toggle
                checked={theme === "dark"}
                onChange={(next) => setTheme(next ? "dark" : "light")}
                label="Karanlık mod"
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Hesap" icon={<User className="size-4" />} />
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">E-posta</dt>
                <dd className="truncate text-content">{user?.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Ad</dt>
                <dd className="text-content">{user?.full_name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Saat dilimi</dt>
                <dd className="text-content">{user?.timezone}</dd>
              </div>
            </dl>
            <Button
              variant="danger"
              size="sm"
              fullWidth
              className="mt-4"
              icon={<LogOut className="size-4" />}
              onClick={logout}
            >
              Çıkış Yap
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function DeviceSettings({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: device.name,
    serial_number: device.serial_number ?? "",
    camera_stream_url: device.camera_stream_url ?? "",
    timezone: device.timezone,
  });

  useEffect(() => {
    setForm({
      name: device.name,
      serial_number: device.serial_number ?? "",
      camera_stream_url: device.camera_stream_url ?? "",
      timezone: device.timezone,
    });
  }, [device.id, device.name, device.serial_number, device.camera_stream_url, device.timezone]);

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        name: form.name,
        serial_number: form.serial_number || null,
        camera_stream_url: form.camera_stream_url || null,
        timezone: form.timezone,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Cihaz ayarları kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Cihaz"
        subtitle={device.model}
        icon={<Cpu className="size-4" />}
        action={
          <Badge tone={device.is_online ? "success" : "neutral"} dot pulse={device.is_online}>
            {device.is_online ? "Çevrimiçi" : "Çevrimdışı"}
          </Badge>
        }
      />
      <div className="space-y-3.5">
        <Input
          name="name"
          label="Robot adı"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          name="serial"
          label="Seri numarası"
          value={form.serial_number}
          onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
          placeholder="XL-2026-0042"
        />
        <Input
          name="camera"
          label="Kamera akış adresi"
          value={form.camera_stream_url}
          onChange={(e) => setForm({ ...form, camera_stream_url: e.target.value })}
          placeholder="http://192.168.1.50:8080/stream"
          hint="Raspberry Pi üzerindeki MJPEG akışının adresi"
          suffix={<Camera className="size-4" />}
        />
        <Input
          name="timezone"
          label="Saat dilimi"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
        <Button variant="primary" fullWidth loading={save.isPending} onClick={() => save.mutate()}>
          Kaydet
        </Button>
      </div>
    </Card>
  );
}

function WorkspaceSettings({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const [dims, setDims] = useState({
    bed_width_mm: String(device.bed_width_mm),
    bed_length_mm: String(device.bed_length_mm),
    max_z_mm: String(device.max_z_mm),
    soil_height_mm: String(device.soil_height_mm),
    safe_height_mm: String(device.safe_height_mm),
  });

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        bed_width_mm: Number(dims.bed_width_mm),
        bed_length_mm: Number(dims.bed_length_mm),
        max_z_mm: Number(dims.max_z_mm),
        soil_height_mm: Number(dims.soil_height_mm),
        safe_height_mm: Number(dims.safe_height_mm),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      toast.success("Çalışma alanı güncellendi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Çalışma Alanı"
        subtitle="Tüm ölçüler milimetre"
        icon={<Ruler className="size-4" />}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          name="width"
          label="Genişlik (X)"
          inputMode="numeric"
          value={dims.bed_width_mm}
          onChange={(e) => setDims({ ...dims, bed_width_mm: e.target.value })}
        />
        <Input
          name="length"
          label="Uzunluk (Y)"
          inputMode="numeric"
          value={dims.bed_length_mm}
          onChange={(e) => setDims({ ...dims, bed_length_mm: e.target.value })}
        />
        <Input
          name="maxz"
          label="Z derinliği"
          inputMode="numeric"
          value={dims.max_z_mm}
          onChange={(e) => setDims({ ...dims, max_z_mm: e.target.value })}
        />
        <Input
          name="soil"
          label="Toprak yüzeyi Z"
          inputMode="numeric"
          value={dims.soil_height_mm}
          onChange={(e) => setDims({ ...dims, soil_height_mm: e.target.value })}
        />
        <Input
          name="safe"
          label="Güvenli yükseklik"
          inputMode="numeric"
          value={dims.safe_height_mm}
          onChange={(e) => setDims({ ...dims, safe_height_mm: e.target.value })}
        />
      </div>
      <Button variant="primary" fullWidth className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>
        Kaydet
      </Button>
    </Card>
  );
}

function HardwareSettings() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [pin, setPin] = useState("");

  const { data: peripherals } = useQuery({
    queryKey: ["peripherals", deviceId],
    queryFn: () => api.hardware.peripherals(deviceId!),
    enabled: Boolean(deviceId),
  });

  const add = useMutation({
    mutationFn: () =>
      api.hardware.createPeripheral(deviceId!, { label, pin: Number(pin) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["peripherals", deviceId] });
      setLabel("");
      setPin("");
      toast.success("Çevre birimi eklendi");
    },
    onError: (error) => toast.error("Eklenemedi", (error as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.hardware.removePeripheral(deviceId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["peripherals", deviceId] });
      toast.success("Çevre birimi silindi");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  const canAdd = label.trim().length > 0 && pin !== "" && !Number.isNaN(Number(pin));

  return (
    <Card>
      <CardHeader
        title="Çevre Birimleri"
        subtitle="GPIO çıkışları: pompa, vana, lamba"
        icon={<Zap className="size-4" />}
      />

      {peripherals?.length ? (
        <ul className="mb-4 space-y-2">
          {peripherals.map((peripheral) => (
            <li
              key={peripheral.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span>{peripheral.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-content">{peripheral.label}</span>
                  <span className="font-mono text-xs text-subtle">GPIO {peripheral.pin}</span>
                </span>
              </span>
              <button
                onClick={() => remove.mutate(peripheral.id)}
                aria-label={`${peripheral.label} sil`}
                className="rounded-lg p-1.5 text-subtle transition-soft hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 py-3 text-center text-sm text-subtle">Tanımlı çevre birimi yok</p>
      )}

      <div className="grid grid-cols-[1fr_100px] gap-2">
        <Input
          name="label"
          placeholder="Ör. Su Pompası"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          name="pin"
          placeholder="Pin"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </div>
      <Button
        className="mt-2"
        fullWidth
        icon={<Plus className="size-4" />}
        disabled={!canAdd}
        loading={add.isPending}
        onClick={() => add.mutate()}
      >
        Ekle
      </Button>
    </Card>
  );
}
