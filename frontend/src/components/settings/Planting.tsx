/**
 * Ekim ayarları — güvenli geçiş, vakumlu tohum ucu ve toprak probu.
 *
 * Bir arada duruyorlar çünkü hepsi aynı soruyu yanıtlıyor: "uç toprağa nasıl
 * inecek?" Kalibrasyon eksenin *nasıl* hareket ettiğini anlatıyor; burası
 * *nereye ve ne kadar* ineceğini.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge, Move3d, Sprout } from "lucide-react";

import { Button, Card, CardHeader, Toggle } from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  readMachineConfig,
  type ProbeConfig,
  type SeederConfig,
} from "@/lib/machine";
import { useServerForm } from "@/hooks/useServerForm";
import { useBotPosition } from "@/store/useBot";
import type { Device } from "@/lib/types";

// --------------------------------------------------------------------------- //
// Güvenli geçiş
// --------------------------------------------------------------------------- //

export function TravelSettings({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings);
  const [guard, setGuard, guardDirty] = useServerForm(stored.travel_guard);
  const [height, setHeight, heightDirty] = useServerForm(String(device.safe_height_mm));
  const position = useBotPosition();

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        safe_height_mm: Number(height),
        settings: { ...device.settings, travel: { enabled: guard } },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      toast.success("Güvenli geçiş güncellendi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Güvenli Geçiş"
        subtitle="Yatayda giderken uç yukarıda"
        icon={<Move3d className="size-4" />}
      />

      <p className="mb-4 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
        Açıkken robot, başka bir koordinata gitmeden veya eve dönmeden önce ucu
        bu yüksekliğe çeker; hedefe varınca indirir. Böylece yol üstündeki
        bitkileri ve takılı ucu ezmez.
      </p>

      <Toggle
        label="Hareketten önce ucu kaldır"
        checked={guard}
        onChange={setGuard}
      />

      <div className="mt-3 space-y-2">
        <NumberField
          name="safe-height"
          label="Güvenli yükseklik Z (mm)"
          value={Number(height) || 0}
          onChange={(v) => setHeight(String(v))}
        />
        <Button
          size="sm"
          fullWidth
          disabled={position.z === null || position.z === undefined}
          onClick={() => setHeight(String(Math.round(position.z ?? 0)))}
        >
          Robotun şu anki Z değerini kullan
          {position.z != null && ` (${Math.round(position.z)} mm)`}
        </Button>
      </div>

      {/* Bu değeri doğrulamak kullanıcıya ait: hangi yönün "yukarı" olduğu
          makineye göre değişiyor ve yanlış bir sayı, her harekette ucu
          toprağa sürtmek demek. Sessizce varsaymaktansa açıkça uyarıyoruz. */}
      <p className="mt-3 text-xs leading-relaxed text-warning">
        Kaydetmeden önce doğrulayın: ucu elle güvenli bir yüksekliğe getirip
        yukarıdaki düğmeyle okutmak en güvenilir yol. Yanlış bir yükseklik her
        harekette ucu toprağa sürter.
      </p>

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        disabled={!guardDirty && !heightDirty}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Kaydet
      </Button>
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// Vakumlu tohum ucu
// --------------------------------------------------------------------------- //

export function SeederSettings({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings);
  const [seeder, setSeeder, dirty] = useServerForm<SeederConfig>(stored.seeder);
  const position = useBotPosition();

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        settings: { ...device.settings, seeder },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      toast.success("Tohum ucu güncellendi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  function num(key: keyof SeederConfig, label: string, suffix = "") {
    return (
      <NumberField
        name={String(key)}
        label={`${label}${suffix}`}
        value={Number(seeder[key]) || 0}
        onChange={(v) => setSeeder({ ...seeder, [key]: v })}
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title="Vakumlu Uç"
        subtitle="Tohum tepsisi ve vakum donanımı"
        icon={<Sprout className="size-4" />}
      />

      <Toggle
        label="Vakumlu uç takılı"
        checked={seeder.enabled}
        onChange={(enabled) => setSeeder({ ...seeder, enabled })}
      />

      <p className="my-3 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
        Ekim sırası: uç tepsiye iner, vakum açılır, tohum uca yapışır, uç
        kalkar, hedefe gider, iner, vakum kapanır ve tohum çukura düşer.
      </p>

      <div className="grid grid-cols-3 gap-2">
        {num("tray_x_mm", "Tepsi X")}
        {num("tray_y_mm", "Tepsi Y")}
        {num("tray_z_mm", "Tepsi Z")}
      </div>

      <Button
        size="sm"
        fullWidth
        className="mt-2"
        disabled={position.x === null || position.x === undefined}
        onClick={() =>
          setSeeder({
            ...seeder,
            tray_x_mm: Math.round(position.x ?? 0),
            tray_y_mm: Math.round(position.y ?? 0),
            tray_z_mm: Math.round(position.z ?? 0),
          })
        }
      >
        Robotun şu anki konumunu tepsi olarak al
      </Button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {num("vacuum_pin", "Vakum pini")}
        {num("default_depth_mm", "Yedek derinlik", " (mm)")}
        {num("pick_dwell_ms", "Alma süresi", " (ms)")}
        {num("release_dwell_ms", "Bırakma süresi", " (ms)")}
      </div>

      {/* Derinlik artık bitkinin kendi ayarı; buradaki yalnızca yedek.
          Aynı sayıyı iki yerde tutmak, hangisinin geçerli olduğu sorusunu
          doğururdu. */}
      <p className="mt-2 text-xs leading-relaxed text-subtle">
        <strong className="text-content">Yedek derinlik</strong> yalnızca bitkinin
        kendi ekim derinliği tanımlı değilse kullanılıyor. Türe özel derinliği{" "}
        <strong className="text-content">Bitki Kütüphanesi</strong>'nde, kartın
        dişli düğmesinden ayarlıyorsunuz.
      </p>

      <p className="mt-2 text-xs leading-relaxed text-subtle">
        Ekim alanı (ofset) artık <strong className="text-content">Tarla
        Tasarımcısı</strong>'nda — sınırı tuvalde görerek ayarlamak, sayıyı
        buradan girip sonucu görmemekten daha güvenilir.
      </p>

      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Bekleme süreleri sahada denenerek bulunur: vakumun tohumu tutması da
        bırakması da anlık değil, pompanın gücüne ve tohumun ağırlığına göre
        değişiyor.
      </p>

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        disabled={!dirty}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Kaydet
      </Button>
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// Toprak nemi probu
// --------------------------------------------------------------------------- //

export function ProbeSettings({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings);
  const [probe, setProbe, dirty] = useServerForm<ProbeConfig>(stored.probe);

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, { settings: { ...device.settings, probe } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      toast.success("Prob ayarları kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Toprak Probu"
        subtitle="Ölçüm derinliği ve bekleme"
        icon={<Gauge className="size-4" />}
      />

      <p className="mb-3 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
        Prob toprağa <strong className="text-content">batırılıyor</strong>:
        yüzeyde tutulan bir okuma havayı ölçer ve her noktada aynı çıkar.
        Okumadan önce beklemek de şart — dirençli prob toprağa girer girmez
        okumuyor, nem iki uç arasında dengelenene kadar birkaç saniye geçiyor.
        Beklemeden okumak ıslak toprağı kuru gösteriyordu.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          name="probe_depth"
          label="Derinlik (mm)"
          value={probe.depth_mm}
          min={0}
          onChange={(depth_mm) => setProbe({ ...probe, depth_mm })}
        />
        <NumberField
          name="probe_settle"
          label="Bekleme (ms)"
          value={probe.settle_ms}
          min={0}
          onChange={(settle_ms) => setProbe({ ...probe, settle_ms })}
        />
      </div>

      <p className="mt-2 text-xs leading-relaxed text-subtle">
        Derinlik toprak yüzeyinden aşağı ölçülüyor. Probun metal ucundan uzun
        bir değer, probu toprağa değil yatağın tabanına sürer.
      </p>

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        disabled={!dirty}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Kaydet
      </Button>
    </Card>
  );
}
