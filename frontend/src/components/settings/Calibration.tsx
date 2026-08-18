/**
 * Ölçüler ve Kalibrasyon.
 *
 * Makinenin kendi kalibrasyon ekranıyla aynı düzen ve aynı alanlar: counts/mm,
 * yön, home, min/max ve eksen başına ölçüm sihirbazı. Alanlar bilerek makinenin
 * terimleriyle adlandırıldı — Gantry Studio'nun `gantry_calib.json` dosyası ve
 * PLC_BRIEF.md §5 aynı isimleri kullanıyor, iki taraf aynı dili konuşsun.
 *
 * Kalibrasyon neden önemli: Gantry Studio konumu PLC register'ından **ham count**
 * olarak veriyor, milimetre değil. `counts/mm` doğru olmadan panelde görünen
 * konum da, göreli hareketin hesapladığı hedef de yanlış çıkıyor.
 *
 * Boş bırakılan her alan "makinenin kendi değerini kullan" demektir.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ruler, Save } from "lucide-react";

import { Badge, Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  AXES,
  cpmFromMeasurement,
  mmFromRaw,
  readMachineConfig,
  type AxisConfig,
  type AxisName,
} from "@/lib/machine";
import { useBotPosition } from "@/store/useBot";
import type { Device } from "@/lib/types";

export function Calibration({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings);
  const [axes, setAxes] = useState(stored.axes);
  const position = useBotPosition();

  /** Ölçüm sihirbazının eksen başına işaretlediği başlangıç konumu (mm). */
  const [marks, setMarks] = useState<Partial<Record<AxisName, number>>>({});
  const [measured, setMeasured] = useState<Partial<Record<AxisName, string>>>({});

  useEffect(() => {
    setAxes(readMachineConfig(device.settings).axes);
  }, [device.id, device.settings]);

  const save = useMutation({
    mutationFn: () => api.devices.update(device.id, { settings: { ...device.settings, axes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Ölçüler kaydedildi", "Bağlı ajana anında iletildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  function patch(axis: AxisName, changes: Partial<AxisConfig>) {
    setAxes((previous) => ({ ...previous, [axis]: { ...previous[axis], ...changes } }));
  }

  function compute(axis: AxisName) {
    const start = marks[axis];
    const travelled = Number(measured[axis]);

    if (start === undefined) {
      toast.error("Önce başlangıcı işaretleyin", "Sonra ekseni sürüp ölçün");
      return;
    }
    if (!Number.isFinite(travelled) || travelled === 0) {
      toast.error("Ölçüm gerekli", "Cetvelle ölçtüğünüz mesafeyi mm olarak yazın");
      return;
    }

    // İşaretlenen ve şimdiki konum, o an geçerli counts/mm ile mm'ye çevrilmiş
    // hâlde geliyor. Makinenin gerçekte saydığı ham count'a geri dönüp
    // kullanıcının ölçtüğü gerçek mesafeye bölüyoruz.
    const config = axes[axis];
    const countsMoved = Math.abs(position[axis] - start) * (config.cpm ?? 1);

    const next = cpmFromMeasurement(countsMoved, travelled);
    if (next === null) {
      toast.error("Hesaplanamadı", "Eksen hareket etmemiş görünüyor");
      return;
    }

    patch(axis, { cpm: Number(next.toFixed(4)) });
    setMeasured((previous) => ({ ...previous, [axis]: "" }));
    setMarks((previous) => ({ ...previous, [axis]: undefined }));
    toast.success(
      `${axis.toUpperCase()} için counts/mm = ${next.toFixed(4)}`,
      "Kaydetmeyi unutmayın",
    );
  }

  const dirty = JSON.stringify(axes) !== JSON.stringify(stored.axes);

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Ölçüler ve Kalibrasyon"
        subtitle="Eksen başına counts/mm, yön ve çalışma aralığı"
        icon={<Ruler className="size-4" />}
        action={dirty ? <Badge tone="warning">Kaydedilmedi</Badge> : undefined}
      />

      <p className="mb-4 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-xs text-muted">
        Her ekseni bir kez kalibre edin:{" "}
        <strong className="text-content">Başlangıcı işaretle</strong>’ye basın, ekseni bilinen
        bir mesafe kadar sürün, gerçek yolu cetvelle ölçüp{" "}
        <strong className="text-content">ölçülen mm</strong> alanına yazın,{" "}
        <strong className="text-content">Hesapla</strong>’ya basın. Bu, counts/mm değerini
        ayarlar; konumlar ve sınırlar böylece gerçek milimetre olur.{" "}
        <strong className="text-content">Max mm</strong> eksenin kullanılabilir strok
        uzunluğudur. <strong className="text-content">Yön</strong> hareket yönünü çevirir.
        Boş bırakılan alanlarda makinenin kendi değeri geçerli olur.
      </p>

      {/* Dar ekranda tablo kendi içinde yatayda kaysın; sayfa gövdesi kaymasın */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th className="px-2 py-2 font-medium">Eksen</th>
              <th className="px-2 py-2 font-medium">counts/mm</th>
              <th className="px-2 py-2 font-medium">Yön</th>
              <th className="px-2 py-2 font-medium">Home mm</th>
              <th className="px-2 py-2 font-medium">Min mm</th>
              <th className="px-2 py-2 font-medium">Max mm</th>
              <th className="px-2 py-2 font-medium">Anlık mm</th>
              <th className="px-2 py-2 font-medium">Kalibrasyon</th>
            </tr>
          </thead>
          <tbody>
            {AXES.map((axis) => {
              const config = axes[axis];
              const marked = marks[axis];
              return (
                <tr key={axis} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-2.5 font-semibold text-content">{axis.toUpperCase()}</td>

                  <td className="px-2 py-2.5">
                    <Cell
                      name={`cpm-${axis}`}
                      value={config.cpm}
                      placeholder="makineden"
                      onChange={(value) => patch(axis, { cpm: value })}
                    />
                  </td>

                  <td className="px-2 py-2.5">
                    <button
                      onClick={() => patch(axis, { dir: config.dir === 1 ? -1 : 1 })}
                      aria-label={`${axis.toUpperCase()} yönünü çevir`}
                      className="h-9 w-12 rounded-lg border border-line bg-surface-2 text-base font-semibold text-content transition-soft hover:border-brand/40 hover:text-brand"
                    >
                      {config.dir === 1 ? "+" : "−"}
                    </button>
                  </td>

                  <td className="px-2 py-2.5">
                    <Cell
                      name={`home-${axis}`}
                      value={config.home_mm}
                      onChange={(value) => patch(axis, { home_mm: value })}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <Cell
                      name={`min-${axis}`}
                      value={config.min_mm}
                      onChange={(value) => patch(axis, { min_mm: value })}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <Cell
                      name={`max-${axis}`}
                      value={config.max_mm}
                      onChange={(value) => patch(axis, { max_mm: value })}
                    />
                  </td>

                  <td className="px-2 py-2.5 font-mono text-brand">
                    {position[axis].toFixed(2)}
                  </td>

                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => {
                          setMarks((previous) => ({ ...previous, [axis]: position[axis] }));
                          toast.info(
                            "Başlangıç işaretlendi",
                            "Şimdi ekseni sürün ve gerçek yolu ölçün",
                          );
                        }}
                      >
                        {marked === undefined ? "Başlangıcı işaretle" : "Yeniden işaretle"}
                      </Button>
                      <Input
                        name={`meas-${axis}`}
                        inputMode="decimal"
                        placeholder="ölçülen mm"
                        className="w-28"
                        value={measured[axis] ?? ""}
                        onChange={(e) =>
                          setMeasured((previous) => ({ ...previous, [axis]: e.target.value }))
                        }
                      />
                      <Button size="sm" variant="primary" onClick={() => compute(axis)}>
                        Hesapla
                      </Button>
                    </div>
                    {marked !== undefined && (
                      <p className="mt-1 font-mono text-xs text-subtle">
                        işaret {marked.toFixed(2)} → şimdi {position[axis].toFixed(2)} mm
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Kaydetmeden önce sonucu somut görmek, yanlış bir counts/mm değerini
          fark etmeyi kolaylaştırıyor. */}
      <div className="mt-4 grid gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-xs sm:grid-cols-3">
        {AXES.map((axis) => (
          <p key={axis} className="font-mono text-subtle">
            {axis.toUpperCase()}: 1000 count → {mmFromRaw(axes[axis], 1000).toFixed(1)} mm
          </p>
        ))}
      </div>

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        icon={<Save className="size-4" />}
        loading={save.isPending}
        disabled={!dirty}
        onClick={() => save.mutate()}
      >
        Ölçüleri Kaydet
      </Button>
    </Card>
  );
}

/**
 * Boş bırakılabilen sayı hücresi.
 *
 * Boş = "makinenin kendi değerini kullan". Değer metin olarak tutuluyor:
 * doğrudan sayıya bağlarsak kullanıcı "-" ya da "0." yazarken ara durum
 * geçersiz sayıya dönüşüp imleç sıfırlanıyor.
 */
function Cell({
  name,
  value,
  placeholder,
  onChange,
}: {
  name: string;
  value: number | null;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));

  useEffect(() => {
    const incoming = value === null ? "" : String(value);
    if (Number(text) !== value || (value === null && text !== "")) setText(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      name={name}
      inputMode="decimal"
      className="w-28"
      placeholder={placeholder ?? "—"}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() === "") {
          onChange(null);
          return;
        }
        // Türkçe klavyede ondalık ayırıcı virgül; makine noktayla çalışıyor
        const parsed = Number(next.replace(",", "."));
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}
