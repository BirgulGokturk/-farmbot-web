/**
 * Eksen kalibrasyonu — ölçek, ofset, yön, sınırlar, hız ve ivme.
 *
 * Neden gerekli?
 *   Hareket komutu PLC'ye Gantry Studio üzerinden gidiyor ve orada `counts-per-mm`
 *   ayarlanmadığı sürece "100 mm git" sahada başka bir mesafeye dönüşüyor. Gantry
 *   Studio'ya dokunmadan, komutu göndermeden önce ajanda bir dönüşüm uyguluyoruz:
 *
 *       makine = ofset + yön × ölçek × kullanıcı_mm
 *
 *   Ölçeği tahmin etmek yerine sahada **ölçüyoruz**: sihirbaz ekseni bilinen bir
 *   mesafe kadar sürüyor, kullanıcı cetvelle gerçekte ne kadar gittiğini giriyor,
 *   ölçek buradan hesaplanıyor.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Compass, Gauge, Ruler, Save, Wand2 } from "lucide-react";

import { Badge, Button, Card, CardHeader, Input, Toggle } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  AXES,
  readMachineConfig,
  scaleFromMeasurement,
  toMachine,
  type AxisConfig,
  type AxisName,
} from "@/lib/machine";
import type { Device } from "@/lib/types";

export function Calibration({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings);
  const [axes, setAxes] = useState(stored.axes);
  const [active, setActive] = useState<AxisName>("x");

  // Cihaz değişirse ya da sunucudan yeni değerler gelirse formu tazele
  useEffect(() => {
    setAxes(readMachineConfig(device.settings).axes);
  }, [device.id, device.settings]);

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        settings: { ...device.settings, axes },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Kalibrasyon kaydedildi", "Bağlı ajana anında iletildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  function patch(axis: AxisName, changes: Partial<AxisConfig>) {
    setAxes((previous) => ({ ...previous, [axis]: { ...previous[axis], ...changes } }));
  }

  const config = axes[active];
  const dirty = JSON.stringify(axes) !== JSON.stringify(stored.axes);

  return (
    <Card>
      <CardHeader
        title="Kalibrasyon"
        subtitle="Her eksen için ayrı ölçek, yön ve limit"
        icon={<Compass className="size-4" />}
        action={dirty ? <Badge tone="warning">Kaydedilmedi</Badge> : undefined}
      />

      {/* Eksen seçici */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {AXES.map((axis) => (
          <button
            key={axis}
            onClick={() => setActive(axis)}
            className={
              active === axis
                ? "h-10 rounded-xl border border-transparent bg-gradient-brand text-sm font-semibold text-white shadow-soft"
                : "h-10 rounded-xl border border-line bg-surface-2 text-sm font-semibold text-muted transition-soft hover:text-content"
            }
          >
            {axis.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <MeasureWizard
          deviceId={device.id}
          axis={active}
          config={config}
          onScale={(scale) => patch(active, { scale })}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            name={`scale-${active}`}
            label="Ölçek"
            value={config.scale}
            step="0.0001"
            hint="1 mm komut = kaç makine birimi"
            onChange={(value) => patch(active, { scale: value })}
          />
          <NumberField
            name={`offset-${active}`}
            label="Ofset"
            value={config.offset}
            hint={active === "x" ? "X sıfır noktası kaydırması" : "Sıfır noktası kaydırması"}
            onChange={(value) => patch(active, { offset: value })}
          />
          <OptionalNumberField
            name={`min-${active}`}
            label="En küçük konum (mm)"
            value={config.min_mm}
            onChange={(value) => patch(active, { min_mm: value })}
          />
          <OptionalNumberField
            name={`max-${active}`}
            label="En büyük konum (mm)"
            value={config.max_mm}
            onChange={(value) => patch(active, { max_mm: value })}
          />
          <NumberField
            name={`speed-${active}`}
            label="Hız"
            value={config.speed}
            onChange={(value) => patch(active, { speed: value })}
          />
          <NumberField
            name={`accel-${active}`}
            label="İvme"
            value={config.accel}
            onChange={(value) => patch(active, { accel: value })}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3">
          <div>
            <p className="text-sm font-medium text-content">Yönü ters çevir</p>
            <p className="text-xs text-subtle">
              Artı tuşu eksene ters yönde hareket ettiriyorsa açın
            </p>
          </div>
          <Toggle
            checked={config.invert}
            onChange={(next) => patch(active, { invert: next })}
            label="Yönü ters çevir"
          />
        </div>

        {/* Ayarların ne anlama geldiğini somut göstermek, hatalı ölçeği
            kaydetmeden fark etmeyi kolaylaştırıyor. */}
        <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-xs">
          <p className="mb-1.5 font-medium text-content">Önizleme</p>
          <ul className="space-y-1 font-mono text-subtle">
            {[10, 100, config.max_mm ?? 1000].map((mm) => (
              <li key={mm}>
                {mm} mm → makineye {toMachine(config, mm).toFixed(2)}
              </li>
            ))}
          </ul>
        </div>

        <Button
          variant="primary"
          fullWidth
          icon={<Save className="size-4" />}
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate()}
        >
          Kalibrasyonu Kaydet
        </Button>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Ölçüm sihirbazı: ekseni bilinen bir mesafe kadar sürer, kullanıcının
 * ölçtüğü gerçek mesafeden ölçeği hesaplar.
 */
function MeasureWizard({
  deviceId,
  axis,
  config,
  onScale,
}: {
  deviceId: string;
  axis: AxisName;
  config: AxisConfig;
  onScale: (scale: number) => void;
}) {
  const [commanded, setCommanded] = useState("100");
  const [measured, setMeasured] = useState("");

  const move = useMutation({
    mutationFn: () =>
      api.control.moveRelative(deviceId, {
        [axis]: Number(commanded),
        speed: config.speed,
      }),
    onSuccess: () =>
      toast.info(
        "Hareket gönderildi",
        `Durduğunda ${axis.toUpperCase()} ekseninin gerçekte kaç mm gittiğini ölçün`,
      ),
    onError: (error) => toast.error("Hareket başarısız", (error as Error).message),
  });

  function compute() {
    const next = scaleFromMeasurement(config.scale, Number(commanded), Number(measured));
    if (next === null) {
      toast.error("Hesaplanamadı", "Komut ve ölçüm sıfırdan farklı sayı olmalı");
      return;
    }
    onScale(next);
    setMeasured("");
    toast.success("Ölçek güncellendi", `Yeni değer ${next.toFixed(5)} — kaydetmeyi unutmayın`);
  }

  return (
    <div className="rounded-xl border border-brand/25 bg-brand/5 p-3.5">
      <p className="mb-1 flex items-center gap-2 text-sm font-medium text-content">
        <Ruler className="size-4 text-brand" />
        Ölçüm sihirbazı
      </p>
      <p className="mb-3 text-xs text-subtle">
        Ekseni sürün, cetvelle gerçekte kaç mm gittiğini ölçüp yazın; ölçek kendiliğinden
        hesaplansın.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Input
          name={`cmd-${axis}`}
          label="Komut (mm)"
          inputMode="decimal"
          value={commanded}
          onChange={(e) => setCommanded(e.target.value)}
        />
        <Input
          name={`meas-${axis}`}
          label="Ölçülen (mm)"
          inputMode="decimal"
          placeholder="cetvelle"
          value={measured}
          onChange={(e) => setMeasured(e.target.value)}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          icon={<Gauge className="size-4" />}
          loading={move.isPending}
          onClick={() => move.mutate()}
        >
          Hareket ettir
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Wand2 className="size-4" />}
          disabled={!measured.trim()}
          onClick={compute}
        >
          Ölçeği hesapla
        </Button>
      </div>
    </div>
  );
}

/**
 * Boş bırakılabilen sayı alanı — yumuşak sınırlar için.
 *
 * Boş = sınır yok. Bunu ayrı bir bileşen yapmamın sebebi: `NumberField` boş
 * girdiyi yok sayıp eski değeri koruyor; sınırlarda ise boşaltmak anlamlı bir
 * eylem (sınırı kaldırmak) ve kaydedilmesi gerekiyor.
 */
function OptionalNumberField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));

  useEffect(() => {
    const incoming = value === null ? "" : String(value);
    if (text !== incoming && Number(text) !== value) setText(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      name={name}
      label={label}
      inputMode="decimal"
      placeholder="sınır yok"
      hint={value === null ? "Boş = sınırsız" : undefined}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() === "") {
          onChange(null);
          return;
        }
        const parsed = Number(next);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}

/**
 * Sayı alanı.
 *
 * Değeri metin olarak tutuyor: doğrudan `number` bağlarsak kullanıcı "-" ya da
 * "0." yazarken ara durum geçersiz sayıya dönüşüp imleç sıfırlanıyor.
 */
function NumberField({
  name,
  label,
  hint,
  value,
  step,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  value: number;
  step?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    // Dışarıdan gelen değer farklıysa (ör. sihirbaz ölçeği yazdı) alanı tazele
    if (Number(text) !== value) setText(String(value));
    // `text` bilerek dışarıda: kullanıcı yazarken kendi kendini ezmesin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      name={name}
      label={label}
      hint={hint}
      inputMode="decimal"
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}
