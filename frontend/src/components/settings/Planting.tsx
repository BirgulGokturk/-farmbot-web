/**
 * Ekim ayarları — ekilebilir alan, güvenli geçiş ve vakumlu tohum ucu.
 *
 * Üçü bir arada duruyor çünkü hepsi aynı soruyu yanıtlıyor: "robot tohumu
 * nereye, nasıl bırakacak?" Kalibrasyon eksenin *nasıl* hareket ettiğini
 * anlatıyor; burası *nereye* gideceğini.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Move3d, Sprout, SquareDashed } from "lucide-react";

import { Button, Card, CardHeader, Input, Toggle } from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { readMachineConfig, type PlantingArea, type SeederConfig } from "@/lib/machine";
import { useServerForm } from "@/hooks/useServerForm";
import { useBotPosition } from "@/store/useBot";
import type { Device } from "@/lib/types";

/** Boş bırakılabilen sayı kutusu: boş = "sınır yok". */
function OptionalNumber({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <Input
      name={label}
      label={label}
      inputMode="numeric"
      placeholder={placeholder}
      value={value === null ? "" : String(value)}
      onChange={(e) => {
        const raw = e.target.value.trim();
        // Boş kutuyu 0'a çevirmiyoruz: 0 geçerli bir kenar ve kullanıcı
        // "sınır yok" demek isterken alanı sıfırdan başlatmış olurdu.
        if (raw === "") return onChange(null);
        // Türkçe klavyede ondalık ayırıcı virgül; noktaya çevirmezsek
        // `Number` NaN döner ve girilen ölçü sessizce yok sayılırdı.
        const parsed = Number(raw.replace(",", "."));
        onChange(Number.isFinite(parsed) ? parsed : null);
      }}
    />
  );
}

// --------------------------------------------------------------------------- //
// Ekilebilir alan
// --------------------------------------------------------------------------- //

export function PlantingAreaSettings({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings);
  const [area, setArea, dirty] = useServerForm<PlantingArea>(stored.planting_area);

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        settings: { ...device.settings, planting_area: area },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      toast.success("Ekim alanı güncellendi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Ekim Alanı"
        subtitle="Toprağın gerçekten başladığı yer"
        icon={<SquareDashed className="size-4" />}
      />

      <p className="mb-4 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
        Yatağın kenarıyla ekilebilir toprağın başladığı yer aynı değil: arada
        profil, kablo kanalı ve saksı duvarı var. Şerit metreyle ölçüp buraya
        girin — rastgele serpiştirme ve ekim yalnızca bu dikdörtgeni kullanır.
        Boş bıraktığınız kenarda yatağın kendi ölçüsü geçerli olur.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <OptionalNumber
          label="X başlangıcı"
          value={area.x_min_mm}
          placeholder="0"
          onChange={(x_min_mm) => setArea({ ...area, x_min_mm })}
        />
        <OptionalNumber
          label="X bitişi"
          value={area.x_max_mm}
          placeholder={String(device.bed_width_mm)}
          onChange={(x_max_mm) => setArea({ ...area, x_max_mm })}
        />
        <OptionalNumber
          label="Y başlangıcı"
          value={area.y_min_mm}
          placeholder="0"
          onChange={(y_min_mm) => setArea({ ...area, y_min_mm })}
        />
        <OptionalNumber
          label="Y bitişi"
          value={area.y_max_mm}
          placeholder={String(device.bed_length_mm)}
          onChange={(y_max_mm) => setArea({ ...area, y_max_mm })}
        />
      </div>

      <p className="mt-3 text-xs text-subtle">
        Ekilebilir alan:{" "}
        <span className="font-mono text-content">
          {((area.x_max_mm ?? device.bed_width_mm) - (area.x_min_mm ?? 0)).toFixed(0)} ×{" "}
          {((area.y_max_mm ?? device.bed_length_mm) - (area.y_min_mm ?? 0)).toFixed(0)} mm
        </span>
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
        title="Tohum Ekimi"
        subtitle="Vakumlu uç ve tohum tepsisi"
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
        {num("default_depth_mm", "Varsayılan derinlik", " (mm)")}
        {num("pick_dwell_ms", "Alma süresi", " (ms)")}
        {num("release_dwell_ms", "Bırakma süresi", " (ms)")}
      </div>

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
