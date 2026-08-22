/**
 * Sulama reçetesi.
 *
 * Sıra eskiden koda gömülüydü: hedefe git, in, pompayı aç, bekle, kapat, kalk.
 * Sahada bu yetmiyor — kimi kurulumda hava pompası suyu itmek için **önce**,
 * kimi kurulumda hattı boşaltmak için **sonra** çalışıyor; kimi bitki köke
 * iniş istiyor, kimi yukarıdan damlama.
 *
 * Altta canlı önizleme var. Uç değiştirme ekranında işe yarayan desen bu:
 * ayarları değiştirirken robotun atacağı adımları görüyorsunuz, çalıştırmadan
 * önce yanlışı fark ediyorsunuz.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets } from "lucide-react";

import { Button, Card, CardHeader, Select, Toggle } from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { readMachineConfig, type IrrigationRecipe } from "@/lib/machine";
import { useServerForm } from "@/hooks/useServerForm";
import { useDeviceId } from "@/hooks/useDevice";
import type { Device } from "@/lib/types";

export function IrrigationSettings({ device }: { device: Device }) {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const stored = readMachineConfig(device.settings).irrigation;
  const [recete, setRecete, dirty] = useServerForm<IrrigationRecipe>(stored);

  // Önizlemede gerçek pin numaralarını göstermek için: "pin 7" yazmak,
  // "su pompası" yazmaktan daha çok işe yarıyor — yanlış pin tanımlıysa
  // burada görülüyor.
  const { data: peripherals } = useQuery({
    queryKey: ["peripherals", deviceId],
    queryFn: () => api.hardware.peripherals(deviceId!),
    enabled: Boolean(deviceId),
  });

  const su = peripherals?.find((p) => p.role === "water_pump");
  const hava = peripherals?.find((p) => p.role === "air_pump");
  const vana = peripherals?.find((p) => p.role === "valve");

  const kaydet = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        settings: { ...device.settings, irrigation: recete },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Sulama reçetesi kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  function alan<K extends keyof IrrigationRecipe>(key: K, value: IrrigationRecipe[K]) {
    setRecete((onceki) => ({ ...onceki, [key]: value }));
  }

  return (
    <Card>
      <CardHeader
        title="Sulama Reçetesi"
        subtitle="Robotun sulama sırasında ne yapacağı"
        icon={<Droplets className="size-4" />}
      />

      {!su && (
        <p className="mb-3 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          Su pompası tanımlı değil. Aşağıdaki ayarlar kaydedilir ama sulama
          çalışmaz — önce <strong>Çevre Birimleri</strong>'nden görevi "su
          pompası" olan bir birim ekleyin.
        </p>
      )}

      {/* --- Hareket --- */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        Hareket
      </p>
      <div className="space-y-2">
        <Toggle
          label="Bitkinin üstüne git"
          checked={recete.go_to_plant}
          onChange={(v) => alan("go_to_plant", v)}
        />
        <Toggle
          label="Toprağa in"
          checked={recete.descend}
          onChange={(v) => alan("descend", v)}
        />
        <Toggle
          label="Bitince ucu kaldır"
          checked={recete.retract}
          onChange={(v) => alan("retract", v)}
        />
      </div>

      {!recete.go_to_plant && (
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          Kapalıyken robot yerinden kıpırdamaz; pompa bulunduğu noktada
          çalışır. Sabit bir hat ya da damlama sistemi için uygun.
        </p>
      )}

      {/* --- Sıra ve süreler --- */}
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">
        Sıra ve süreler
      </p>

      <Select
        name="sira"
        label="Hangisi önce"
        value={recete.water_first ? "su" : "hava"}
        onChange={(e) => alan("water_first", e.target.value === "su")}
      >
        <option value="su">Önce su, sonra hava</option>
        <option value="hava">Önce hava, sonra su</option>
      </Select>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField
          label="Varınca bekle (ms)"
          value={recete.pre_delay_ms}
          min={0}
          onChange={(v) => alan("pre_delay_ms", v)}
        />
        <NumberField
          label="Su süresi (ms)"
          value={recete.water_ms}
          min={0}
          onChange={(v) => alan("water_ms", v)}
        />
        <NumberField
          label="Vana → pompa (ms)"
          value={recete.valve_lead_ms}
          min={0}
          onChange={(v) => alan("valve_lead_ms", v)}
        />
        <NumberField
          label="Pompa → vana kapat (ms)"
          value={recete.valve_lag_ms}
          min={0}
          onChange={(v) => alan("valve_lag_ms", v)}
        />
        <NumberField
          label="Pompalar arası (ms)"
          value={recete.between_ms}
          min={0}
          onChange={(v) => alan("between_ms", v)}
        />
        <NumberField
          label="Hava süresi (ms)"
          value={recete.air_ms}
          min={0}
          onChange={(v) => alan("air_ms", v)}
        />
        <NumberField
          label="Bitince bekle (ms)"
          value={recete.post_delay_ms}
          min={0}
          onChange={(v) => alan("post_delay_ms", v)}
        />
      </div>

      <p className="mt-2 text-xs leading-relaxed text-subtle">
        Hava süresi <strong className="text-content">0</strong> ise hava pompası
        hiç çalışmaz. Süreler milisaniye: 1000 ms = 1 saniye.
      </p>

      <p className="mt-2 text-xs leading-relaxed text-subtle">
        Vana su hattında ve pompayı <strong className="text-content">sarmalıyor</strong>:
        pompadan önce açılıyor, sonra kapanıyor. Pompayı kapalı vanaya karşı
        çalıştırmak hattı zorlar; vanayı pompa durur durmaz kapatmak da hatta
        basınç hapseder. İki bekleme bunun için.
      </p>

      {/* --- Önizleme --- */}
      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3.5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Robotun atacağı adımlar
        </p>
        <ol className="space-y-1 font-mono text-[11px] leading-relaxed text-success/85">
          {onizleme(recete, su?.pin, hava?.pin, vana?.pin).map((satir, i) => (
            <li key={i}>
              {i + 1}. {satir}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-subtle">
          Toplam yaklaşık {(toplamSure(recete, Boolean(vana)) / 1000).toFixed(1)} saniye
          (hareket süresi hariç).
        </p>
      </div>

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        disabled={!dirty}
        loading={kaydet.isPending}
        onClick={() => kaydet.mutate()}
      >
        Kaydet
      </Button>
    </Card>
  );
}

/**
 * Önizleme — sunucudaki `sulama_recetesi` ile **aynı kuralları** izliyor.
 *
 * İkisi ayrı yazıldığı için birbirinden kayma riski var; bu yüzden kurallar
 * burada da açıkça yazılı ve sunucu tarafındaki yorumla aynı gerekçeleri
 * taşıyor. Önizlemenin yalan söylemesi, çalıştırmadan önce kontrol etme
 * imkânını yok ederdi.
 */
function onizleme(
  r: IrrigationRecipe,
  suPin: number | undefined,
  havaPin: number | undefined,
  vanaPin: number | undefined,
): string[] {
  const adimlar: string[] = [];

  if (r.go_to_plant) {
    adimlar.push("bitkinin üstüne git (güvenli yükseklikte)");
    if (r.descend) adimlar.push("toprağa in");
  } else {
    adimlar.push("yerinde kal — hareket yok");
  }

  if (r.pre_delay_ms) adimlar.push(`${r.pre_delay_ms} ms bekle`);

  const pompa = (ad: string, pin: number | undefined, sure: number) =>
    !pin || sure <= 0 ? [] : [`${ad} aç (pin ${pin})`, `${sure} ms bekle`, `${ad} kapat`];

  const su = pompa("su pompasını", suPin, r.water_ms);
  const hava = pompa("hava pompasını", havaPin, r.air_ms);

  // Vana yalnızca su gerçekten akacaksa açılıyor
  const vanaVar = Boolean(vanaPin) && su.length > 0;
  if (vanaVar) {
    adimlar.push(`vanayı aç (pin ${vanaPin})`);
    if (r.valve_lead_ms) adimlar.push(`${r.valve_lead_ms} ms bekle`);
  }

  const [once, sonra] = r.water_first ? [su, hava] : [hava, su];
  adimlar.push(...once);
  // Bekleme yalnızca iki pompa da çalışıyorsa anlamlı
  if (once.length && sonra.length && r.between_ms) {
    adimlar.push(`${r.between_ms} ms bekle`);
  }
  adimlar.push(...sonra);

  if (vanaVar) {
    if (r.valve_lag_ms) adimlar.push(`${r.valve_lag_ms} ms bekle`);
    adimlar.push("vanayı kapat");
  }

  if (r.post_delay_ms) adimlar.push(`${r.post_delay_ms} ms bekle`);
  if (r.retract && r.go_to_plant) adimlar.push("ucu güvenli yüksekliğe çek");

  if (!su.length && !hava.length) {
    adimlar.push("⚠ hiçbir pompa çalışmıyor — süre 0 ya da pompa tanımsız");
  }
  return adimlar;
}

function toplamSure(r: IrrigationRecipe, vanaVar: boolean): number {
  const arada = r.water_ms > 0 && r.air_ms > 0 ? r.between_ms : 0;
  const vana = vanaVar && r.water_ms > 0 ? r.valve_lead_ms + r.valve_lag_ms : 0;
  return r.pre_delay_ms + vana + r.water_ms + arada + r.air_ms + r.post_delay_ms;
}
