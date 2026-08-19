/**
 * Kurulum sihirbazı — yeni bir makineyi baştan sona ayağa kaldırma akışı.
 *
 * Neden gerekli: kurulum için gereken dört şey (ölçüler, köprü ajanı token'ı,
 * eksen kalibrasyonu, takılı sensörler) panelin dört ayrı köşesine dağılmıştı.
 * Hangisinin yapıldığını, hangisinin eksik kaldığını görmenin bir yolu yoktu;
 * sahada en çok vakit kaybettiren şey buydu.
 *
 * Sihirbaz aynı zamanda bir **sağlık kontrolü**: her adım "tamamlandı mı"yı
 * gerçek veriden okuyor (cihaz kayıtlı mı, token üretilmiş mi, counts/mm
 * girilmiş mi, sensörler gözden geçirilmiş mi). Bu yüzden kurulum bittikten
 * sonra da geri gelip bakabilirsiniz — bir şey bozulduğunda hangi halkanın
 * koptuğu tek ekranda görünüyor.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Copy,
  Cable,
  Compass,
  Rocket,
  Ruler,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Spinner,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { AXES, readMachineConfig, type AxisName } from "@/lib/machine";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useServerForm } from "@/hooks/useServerForm";
import { cn } from "@/lib/cn";
import type { Device } from "@/lib/types";

const STEPS = [
  { key: "device", title: "Makine ölçüleri", Icon: Ruler },
  { key: "agent", title: "Köprü ajanı", Icon: Cpu },
  { key: "calibration", title: "Kalibrasyon", Icon: Compass },
  { key: "sensors", title: "Sensörler", Icon: Cable },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export default function Setup() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const [step, setStep] = useState(0);

  const { data: agentStatus } = useQuery({
    queryKey: ["agent-status", deviceId],
    queryFn: () => api.agent.status(deviceId!),
    enabled: Boolean(deviceId),
    refetchInterval: 5000,
  });

  const { data: sensors } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId!),
    enabled: Boolean(deviceId),
  });

  if (!device) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Spinner className="size-7 text-brand" />
      </div>
    );
  }

  const config = readMachineConfig(device.settings);

  /**
   * Adımların "tamam" durumu gerçek veriden okunuyor; kullanıcı sihirbazı
   * yarıda bırakıp doğrudan ayarlardan da hallettiyse burası doğru görünsün.
   */
  const done: Record<StepKey, boolean> = {
    device: device.bed_width_mm > 0 && device.bed_length_mm > 0,
    agent: Boolean(agentStatus?.has_token),
    calibration: AXES.every((axis) => config.axes[axis].cpm !== null),
    sensors: (sensors ?? []).length > 0,
  };
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kurulum"
        description="Yeni bir makineyi ayağa kaldırmak için dört adım"
        icon={<Rocket className="size-5" />}
        actions={
          <Badge tone={completed === STEPS.length ? "success" : "warning"}>
            {completed}/{STEPS.length} adım tamam
          </Badge>
        }
      />

      {/* Adım çubuğu — tıklanabilir, sıra zorunlu değil */}
      <ol className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((item, index) => (
          <li key={item.key}>
            <button
              onClick={() => setStep(index)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-soft",
                index === step
                  ? "border-brand/40 bg-brand/10"
                  : "border-line bg-surface-2 hover:border-brand/25",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold",
                  done[item.key] ? "bg-success/15 text-success" : "bg-surface text-subtle",
                )}
              >
                {done[item.key] ? <Check className="size-4" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-content">
                  {item.title}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <DeviceStep device={device} />}
      {step === 1 && <AgentStep deviceId={device.id} hasToken={Boolean(agentStatus?.has_token)} connected={Boolean(agentStatus?.connected)} />}
      {step === 2 && <CalibrationStep device={device} />}
      {step === 3 && <SensorStep deviceId={device.id} />}

      <div className="flex items-center justify-between">
        <Button
          icon={<ChevronLeft className="size-4" />}
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Geri
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            İleri <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Link to="/">
            <Button variant="primary">Kontrol Merkezi'ne git</Button>
          </Link>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

/** 1. adım — makinenin gerçek strok ölçüleri. */
function DeviceStep({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const [form, setForm, dirty] = useServerForm({
    name: device.name,
    bed_width_mm: String(device.bed_width_mm),
    bed_length_mm: String(device.bed_length_mm),
    max_z_mm: String(device.max_z_mm),
  });

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        name: form.name,
        bed_width_mm: Number(form.bed_width_mm),
        bed_length_mm: Number(form.bed_length_mm),
        max_z_mm: Number(form.max_z_mm),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Ölçüler kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Makine ölçüleri"
        subtitle="Eksenlerin gidebildiği gerçek mesafe"
        icon={<Ruler className="size-4" />}
      />
      <p className="mb-4 text-sm text-muted">
        Buraya bahçenin ekilebilir alanını değil, <strong className="text-content">eksenlerin
        gerçek strok uzunluğunu</strong> yazın. 3B görünüm, tarla tasarımcısı ve yumuşak
        sınırlar bu ölçülere göre çalışıyor.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          name="name"
          label="Robot adı"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div />
        <Input
          name="width"
          label="X ekseni (mm)"
          inputMode="numeric"
          value={form.bed_width_mm}
          onChange={(e) => setForm({ ...form, bed_width_mm: e.target.value })}
        />
        <Input
          name="length"
          label="Y ekseni (mm)"
          inputMode="numeric"
          value={form.bed_length_mm}
          onChange={(e) => setForm({ ...form, bed_length_mm: e.target.value })}
        />
        <Input
          name="maxz"
          label="Z ekseni (mm)"
          inputMode="numeric"
          value={form.max_z_mm}
          onChange={(e) => setForm({ ...form, max_z_mm: e.target.value })}
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        loading={save.isPending}
        disabled={!dirty}
        onClick={() => save.mutate()}
      >
        Kaydet
      </Button>
    </Card>
  );
}

/** 2. adım — Raspberry Pi köprüsünün token'ı ve kurulum komutları. */
function AgentStep({
  deviceId,
  hasToken,
  connected,
}: {
  deviceId: string;
  hasToken: boolean;
  connected: boolean;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.agent.createToken(deviceId),
    onSuccess: (result) => {
      setToken(result.token);
      void queryClient.invalidateQueries({ queryKey: ["agent-status", deviceId] });
    },
    onError: (error) => toast.error("Token üretilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Köprü ajanı"
        subtitle="Raspberry Pi'yi buluta bağlar"
        icon={<Cpu className="size-4" />}
        action={
          <Badge tone={connected ? "success" : hasToken ? "warning" : "neutral"} dot>
            {connected ? "Bağlı" : hasToken ? "Token var, bağlı değil" : "Kurulmadı"}
          </Badge>
        }
      />

      <p className="mb-4 text-sm text-muted">
        Ajan, Arduino'dan gelen sensör verisini buluta taşır ve panelden gönderdiğiniz
        hareket komutlarını Gantry Studio'ya iletir. Token, robotun kimliğidir.
      </p>

      <Button
        variant={hasToken ? "secondary" : "primary"}
        fullWidth
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        {hasToken ? "Yeni token üret (eskisi geçersiz olur)" : "Token üret"}
      </Button>

      {token && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3">
            <p className="mb-2 text-xs font-medium text-warning">
              Bu token yalnızca şimdi gösteriliyor — kopyalayın
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2.5 py-2 font-mono text-xs text-content">
                {token}
              </code>
              <Button
                size="sm"
                icon={<Copy className="size-3.5" />}
                onClick={() => {
                  void navigator.clipboard.writeText(token);
                  toast.success("Kopyalandı");
                }}
              >
                Kopyala
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-content">Raspberry Pi'de çalıştırın</p>
            <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3.5 font-mono text-xs leading-relaxed text-muted">
{`sudo tee /etc/systemd/system/farmbot-agent.service > /dev/null <<EOF
[Unit]
Description=FarmBot kopru ajani
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/farmbot-web/agent
Environment=FARMBOT_SERIAL_PORT=/dev/ttyUSB0
Environment=FARMBOT_BAUD=9600
Environment=FARMBOT_GANTRY_URL=http://localhost:8091
Environment=FARMBOT_API_URL=https://farmbot-api.onrender.com
Environment=FARMBOT_DEVICE_TOKEN=${token}
ExecStart=$HOME/farmbot-web/agent/.venv/bin/python farmbot_agent.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=farmbot-agent

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now farmbot-agent
journalctl -u farmbot-agent -n 20 --no-pager`}
            </pre>
            <p className="mt-2 text-xs text-subtle">
              Günlükte “Komut kanalı açıldı” satırını görmelisiniz. Bu kart o an
              kendiliğinden “Bağlı” yazacak.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

/** 3. adım — eksen başına counts/mm. */
function CalibrationStep({ device }: { device: Device }) {
  const config = readMachineConfig(device.settings);

  return (
    <Card>
      <CardHeader
        title="Kalibrasyon"
        subtitle="Eksen başına counts/mm"
        icon={<Compass className="size-4" />}
      />

      <p className="mb-4 text-sm text-muted">
        Gantry Studio konumu PLC register'ından <strong className="text-content">ham count</strong>{" "}
        olarak veriyor, milimetre değil. counts/mm doğru olmadan hem panelde görünen konum
        hem de göreli hareketin hesapladığı hedef yanlış çıkar.
      </p>

      <ul className="mb-4 space-y-2">
        {AXES.map((axis: AxisName) => {
          const value = config.axes[axis].cpm;
          return (
            <li
              key={axis}
              className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5"
            >
              <span className="text-sm font-medium text-content">{axis.toUpperCase()} ekseni</span>
              <span className="font-mono text-sm">
                {value === null ? (
                  <span className="text-subtle">makineden alınıyor</span>
                ) : (
                  <span className="text-brand">{value} count/mm</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mb-3 text-xs text-subtle">
        Boş bırakılan eksenlerde makinenin kendi kalibrasyonu geçerli olur — ajan bunu
        açılışta <code className="font-mono">/api/calib</code> üzerinden okuyor. Kendiniz
        ölçmek isterseniz ölçüm sihirbazı ayarlar sayfasında.
      </p>

      <Link to="/settings">
        <Button fullWidth icon={<Compass className="size-4" />}>
          Ölçüler ve Kalibrasyon'u aç
        </Button>
      </Link>
    </Card>
  );
}

/** 4. adım — hangi sensörler fiziksel olarak takılı. */
function SensorStep({ deviceId }: { deviceId: string }) {
  const queryClient = useQueryClient();

  const { data: sensors } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId),
  });

  const toggle = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      api.hardware.updateSensor(deviceId, id, { installed: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sensors", deviceId] });
      void queryClient.invalidateQueries({ queryKey: ["latest-readings", deviceId] });
    },
    onError: (error) => toast.error("Değiştirilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Takılı sensörler"
        subtitle="Fiziksel olarak bağlı olmayanları kapatın"
        icon={<Cable className="size-4" />}
      />

      <p className="mb-4 text-sm text-muted">
        Arduino, sensör bağlı olmayan analog pini de okur; boştaki pin gürültü üretir ve
        grafikte gerçek gibi görünen anlamsız bir eğri oluşur. Takılı olmayanı kapatın —
        ölçümler kaydedilmeye devam eder, sadece gösterilmez.
      </p>

      {sensors?.length ? (
        <ul className="space-y-2">
          {sensors.map((sensor) => (
            <li
              key={sensor.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="text-base">{sensor.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-content">{sensor.label}</span>
                  <span className="font-mono text-xs text-subtle">{sensor.channel}</span>
                </span>
              </span>
              <Toggle
                checked={sensor.installed}
                disabled={toggle.isPending}
                onChange={(next) => toggle.mutate({ id: sensor.id, next })}
                label={`${sensor.label} takılı`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-subtle">
          Henüz sensör tanımlı değil. Ajan ilk ölçümü gönderdiğinde kanallar kendiliğinden
          oluşur; bu adıma sonra dönün.
        </p>
      )}
    </Card>
  );
}
