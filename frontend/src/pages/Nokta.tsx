/**
 * Noktada İşlem.
 *
 * Neden var
 * ---------
 * Ekim ve sulama, tasarımda kayıtlı bir bitkiye bağlı çalışıyordu. Tek bir
 * noktayı denemek — "şuraya bir tohum bırak", "burayı sula", "buranın nemi
 * kaç" — için önce tarla tasarımcısında bitki açmak, sonra silmek gerekiyordu.
 * Deneme yapan biri için gereksiz bir yol; sahada en çok istenen şey de buydu.
 *
 * Vakumlu Uç ayarları yalnızca veri tutuyor, hareket üretmiyor. Burası o
 * ayarları çalıştıran yer.
 *
 * Neden tek sayfada üç iş
 * -----------------------
 * Üçü de aynı iskeleti paylaşıyor: doğru ucu tak → noktaya git → işi yap.
 * Değişen yalnızca son adım. Üç ayrı sayfa, aynı koordinatı üç kez girmek
 * demek olurdu.
 *
 * Önizleme
 * --------
 * Çalıştırmadan önce robotun atacağı adımlar yazılı. Sulama reçetesinde işe
 * yarayan desen bu: yanlış bir sayı, robot hareket etmeden fark ediliyor.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Crosshair,
  Droplets,
  Gauge,
  MapPin,
  Play,
  Sprout,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { readMachineConfig, readMachineSpans } from "@/lib/machine";
import { cn } from "@/lib/cn";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBot, useBotPosition } from "@/store/useBot";
import type { SpotAction } from "@/lib/types";

interface IsTanimi {
  value: SpotAction;
  label: string;
  aciklama: string;
  icon: typeof Sprout;
  /** Bu işi yapacak ucun yuva görevi. */
  gorev: "seeder" | "waterer" | "soil_probe";
}

/**
 * Arduino sensör verisini kendi döngüsünde bu aralıkla yayınlıyor.
 * Sunucudaki `ARDUINO_YAYIN_MS` ile aynı sayı: önizlemenin gösterdiği süre,
 * robotun gerçekten bekleyeceği süre olmalı.
 */
const ARDUINO_YAYIN_MS = 2000;

const ISLER: IsTanimi[] = [
  {
    value: "sow",
    label: "Tohum bırak",
    aciklama: "Tepsiden tohumu vakumla alır, noktaya götürüp bırakır",
    icon: Sprout,
    gorev: "seeder",
  },
  {
    value: "water",
    label: "Sula",
    aciklama: "Sulama reçetesini bu noktada uygular",
    icon: Droplets,
    gorev: "waterer",
  },
  {
    value: "soil_probe",
    label: "Toprak nemini ölç",
    aciklama: "Probu toprağa batırır, dengelenince okur ve çeker",
    icon: Gauge,
    gorev: "soil_probe",
  },
];

export default function Nokta() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const konum = useBotPosition();
  const sonOlcumler = useBot((s) => s.lastReadings);
  const botDurumu = useBot((s) => s.status);

  const [is, setIs] = useState<SpotAction>("sow");
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [derinlik, setDerinlik] = useState<number | null>(null);
  const [sure, setSure] = useState<number | null>(null);
  const [probDerinlik, setProbDerinlik] = useState<number | null>(null);
  /** Son çalıştırmanın zamanı — ondan önceki ölçümler sonuç sayılmıyor. */
  const [calistirmaAni, setCalistirmaAni] = useState<number | null>(null);

  const { data: sensors } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId!),
    enabled: Boolean(deviceId),
  });
  const { data: peripherals } = useQuery({
    queryKey: ["peripherals", deviceId],
    queryFn: () => api.hardware.peripherals(deviceId!),
    enabled: Boolean(deviceId),
  });

  const config = readMachineConfig(device?.settings);
  const secili = ISLER.find((i) => i.value === is)!;

  const toprakSensoru = (sensors ?? []).find(
    (s) => s.kind === "soil_moisture" && s.installed,
  );
  const suPompasi = (peripherals ?? []).find((p) => p.role === "water_pump");
  const yuva = config.tool_zone.slots.find((s) => s.role === secili.gorev);

  const calistir = useMutation({
    mutationFn: () =>
      api.control.spot(deviceId!, {
        x,
        y,
        action: is,
        ...(is === "sow" && derinlik !== null ? { depth_mm: derinlik } : {}),
        ...(is === "water" && sure !== null ? { duration_ms: sure } : {}),
        ...(is === "soil_probe" && probDerinlik !== null
          ? { probe_depth_mm: probDerinlik }
          : {}),
      }),
    onMutate: () => setCalistirmaAni(Date.now()),
    onSuccess: (yanit) => toast.success("Sıraya alındı", yanit.detail ?? undefined),
    onError: (error) => toast.error("Çalıştırılamadı", (error as Error).message),
  });

  // --- Hazır mı? --------------------------------------------------------- //
  //
  // Engel varsa düğmeyi kapatıp sebebini yazıyoruz. Eskiden komut gidiyor,
  // sunucu 422 dönüyor ve kullanıcı hatayı ancak bastıktan sonra görüyordu.
  const engeller: string[] = [];
  if (is === "sow" && !config.seeder.enabled) {
    engeller.push("Vakumlu uç tanımlı değil — Ayarlar → Vakumlu Uç.");
  }
  if (is === "water" && !suPompasi) {
    engeller.push("Su pompası tanımlı değil — Ayarlar → Çevre Birimleri.");
  }
  if (is === "soil_probe" && !toprakSensoru) {
    engeller.push("Toprak nemi sensörü yok — Sensörler sayfasından tanımlayın.");
  }

  // Uç yuvası eksikse iş yine yapılır, ama uç takılmadan. Engel değil uyarı:
  // tek uçlu bir makinede uç değiştirme diye bir şey yok.
  const uyarilar: string[] = [];
  if (!yuva) {
    uyarilar.push(
      `"${secili.label}" için uç yuvası atanmamış — robot ucu almadan gider.`,
    );
  }

  const alan = config.planting_area;
  const ekimDisinda =
    is === "sow" &&
    ((alan.x_min_mm !== null && x < alan.x_min_mm) ||
      (alan.x_max_mm !== null && x > alan.x_max_mm) ||
      (alan.y_min_mm !== null && y < alan.y_min_mm) ||
      (alan.y_max_mm !== null && y > alan.y_max_mm));
  if (ekimDisinda) {
    engeller.push(
      "Nokta ekim alanının dışında — tohum toprağa değil profile düşer.",
    );
  }

  const yatakDisinda =
    device !== undefined &&
    (x < 0 || x > device.bed_width_mm || y < 0 || y > device.bed_length_mm);
  if (yatakDisinda) {
    engeller.push(
      `Nokta çalışma alanının dışında (X 0–${device!.bed_width_mm}, Y 0–${device!.bed_length_mm} mm).`,
    );
  }

  /*
   * Makinenin gerçek aralığı ayrı bir kontrol.
   *
   * "Çalışma Alanı" ayarındaki yatak ölçüsü kullanıcının girdiği sayı;
   * makinenin gidebildiği yer ise PLC'nin yumuşak sınırı. İkisi ayrıldığında
   * panel komutu kabul ediyor, robot reddediyor ve hata makine dilinde
   * dönüyor: "Y target -1.8 mm outside limits [0.0, 480.0]". Komutu gönderen
   * için bu cümle hiçbir şey ifade etmiyor — burada, Türkçe ve çalıştırmadan
   * önce söylüyoruz.
   */
  const spans = readMachineSpans(botDurumu);
  const disari = (eksen: "x" | "y" | "z", deger: number, ad: string) => {
    const span = spans[eksen];
    if (!span || (deger >= span.min && deger <= span.max)) return;
    engeller.push(
      `${ad} ${deger.toFixed(0)} mm, makinenin ${eksen.toUpperCase()} aralığının ` +
        `dışında (${span.min.toFixed(0)}–${span.max.toFixed(0)} mm).`,
    );
  };
  disari("x", x, "Hedef X");
  disari("y", y, "Hedef Y");

  // İnilecek Z de sınır içinde olmalı; en sık gözden kaçan bu, çünkü
  // ekranda hiçbir yerde yazmıyor — toprak yüzeyi ayarından hesaplanıyor.
  if (device) {
    if (is === "sow") {
      disari("z", device.soil_height_mm - (derinlik ?? config.seeder.default_depth_mm), "Tohum Z'si");
    } else if (is === "soil_probe") {
      disari("z", device.soil_height_mm - (probDerinlik ?? config.probe.depth_mm), "Prob Z'si");
    } else {
      disari("z", device.soil_height_mm, "Toprak yüzeyi Z");
    }
  }

  // Yayındaki son ölçüm, komutun **sonucu değil**. Kanallı sensör iki
  // saniyede bir yayın yapıyor; robot hiç kıpırdamadan da bu kart dolu
  // görünüyordu ve ölçüm alınmış gibi okunuyordu. Bu yüzden yalnızca
  // çalıştırma anından **sonra** gelen ölçüm gösteriliyor.
  const ham = toprakSensoru ? sonOlcumler[toprakSensoru.id] : undefined;
  const olcum =
    ham && calistirmaAni !== null && Date.parse(ham.read_at) >= calistirmaAni
      ? ham
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Noktada İşlem"
        description="Koordinat gir, robot oraya gidip işi yapsın"
        icon={<MapPin className="size-5" />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* --- Sol: iş ve koordinat --- */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Ne yapılsın?" />
            <div className="space-y-2">
              {ISLER.map((tanim) => {
                const Icon = tanim.icon;
                const aktif = tanim.value === is;
                return (
                  <button
                    key={tanim.value}
                    type="button"
                    aria-pressed={aktif}
                    onClick={() => setIs(tanim.value)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-soft",
                      aktif
                        ? "border-brand bg-brand/10"
                        : "border-line bg-surface-2 hover:bg-surface-3",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-5 shrink-0",
                        aktif ? "text-brand" : "text-subtle",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-content">
                        {tanim.label}
                      </span>
                      <span className="text-xs text-subtle">{tanim.aciklama}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Nokta"
              subtitle="Yatak koordinatı, milimetre"
              icon={<Crosshair className="size-4" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField name="x" label="X" value={x} onChange={setX} />
              <NumberField name="y" label="Y" value={y} onChange={setY} />
            </div>
            <Button
              size="sm"
              fullWidth
              className="mt-3"
              icon={<Crosshair className="size-3.5" />}
              onClick={() => {
                setX(Math.round(konum.x));
                setY(Math.round(konum.y));
              }}
            >
              Robotun şu anki konumunu al (X{Math.round(konum.x)} Y{Math.round(konum.y)})
            </Button>

            {/* İşe özel alanlar. Boş bırakılanlar ayarlardaki değere düşüyor;
                her seferinde aynı sayıyı yazdırmanın anlamı yok. */}
            {is === "sow" && (
              <div className="mt-4">
                <NumberField
                  name="derinlik"
                  label="Ekim derinliği (mm)"
                  value={derinlik ?? config.seeder.default_depth_mm}
                  min={0}
                  onChange={setDerinlik}
                />
                <p className="mt-1 text-xs text-subtle">
                  Toprak yüzeyinden aşağı. Boş bırakılırsa ayarlardaki{" "}
                  {config.seeder.default_depth_mm} mm geçerli.
                </p>
              </div>
            )}

            {is === "water" && (
              <div className="mt-4">
                <NumberField
                  name="sure"
                  label="Su süresi (ms)"
                  value={sure ?? config.irrigation.water_ms}
                  min={0}
                  onChange={setSure}
                />
                <p className="mt-1 text-xs text-subtle">
                  Reçetenin geri kalanı (vana, hava pompası, beklemeler) olduğu
                  gibi uygulanıyor. 1000 ms = 1 saniye.
                </p>
              </div>
            )}

            {is === "soil_probe" && (
              <div className="mt-4">
                <NumberField
                  name="prob"
                  label="Prob derinliği (mm)"
                  value={probDerinlik ?? config.probe.depth_mm}
                  min={0}
                  onChange={setProbDerinlik}
                />
                {sensors && sensors.length > 0 && (
                  <Select
                    name="sensor"
                    label="Sensör"
                    className="mt-3"
                    value={toprakSensoru?.id ?? ""}
                    disabled
                  >
                    <option value={toprakSensoru?.id ?? ""}>
                      {toprakSensoru
                        ? `${toprakSensoru.icon} ${toprakSensoru.label}`
                        : "Toprak nemi sensörü yok"}
                    </option>
                  </Select>
                )}
                <p className="mt-1 text-xs leading-relaxed text-subtle">
                  Yüzeyde tutulan bir okuma havayı ölçer; prob bu yüzden
                  batırılıyor ve okumadan önce{" "}
                  {(config.probe.settle_ms / 1000).toFixed(1)} sn bekleniyor.
                  {toprakSensoru && toprakSensoru.pin == null && (
                    <>
                      {" "}
                      Bu sensör bir pine bağlı değil — Arduino ölçümü kendi
                      döngüsünde yayınlıyor, robot yalnızca noktada bekliyor ve
                      ölçüm o konuma yazılıyor.
                    </>
                  )}
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* --- Sağ: önizleme ve çalıştır --- */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Robotun atacağı adımlar"
              subtitle="Çalıştırmadan önce kontrol edin"
              action={
                yuva ? (
                  <Badge tone="success" dot>
                    {yuva.label}
                  </Badge>
                ) : (
                  <Badge tone="warning">Uç yok</Badge>
                )
              }
            />
            <ol className="space-y-1 font-mono text-[11px] leading-relaxed text-success/85">
              {onizleme({
                is,
                x,
                y,
                yuvaAdi: yuva?.label ?? null,
                gantryAdi: yuva?.name ?? null,
                takili: config.tool_zone.current_tool,
                seeder: config.seeder,
                derinlik: derinlik ?? config.seeder.default_depth_mm,
                suSuresi: sure ?? config.irrigation.water_ms,
                havaSuresi: config.irrigation.air_ms,
                probDerinlik: probDerinlik ?? config.probe.depth_mm,
                bekleme: Math.max(
                  config.probe.settle_ms,
                  toprakSensoru?.pin == null ? ARDUINO_YAYIN_MS * 2 : 0,
                ),
                suPin: suPompasi?.pin ?? null,
                sensorAdi: toprakSensoru?.label ?? null,
                sensorPinli: toprakSensoru?.pin != null,
              }).map((satir, i) => (
                <li key={i}>
                  {i + 1}. {satir}
                </li>
              ))}
            </ol>
          </Card>

          {(engeller.length > 0 || uyarilar.length > 0) && (
            <Card>
              {engeller.length > 0 && (
                <ul className="space-y-1 rounded-xl bg-danger/10 p-3 text-xs leading-relaxed text-danger">
                  {engeller.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {uyarilar.length > 0 && (
                <ul
                  className={cn(
                    "space-y-1 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning",
                    engeller.length > 0 && "mt-2",
                  )}
                >
                  {uyarilar.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon={<Play className="size-4" />}
            disabled={engeller.length > 0 || !deviceId}
            loading={calistir.isPending}
            onClick={() => calistir.mutate()}
          >
            Çalıştır
          </Button>

          {is === "soil_probe" && (
            <Card>
              <CardHeader title="Son ölçüm" icon={<Gauge className="size-4" />} />
              {olcum ? (
                <div className="text-center">
                  <p className="font-display text-4xl font-semibold text-brand">
                    {olcum.value.toFixed(1)}
                    <span className="ml-1 text-lg text-subtle">
                      {toprakSensoru?.unit}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-subtle">
                    {new Date(olcum.read_at).toLocaleTimeString("tr-TR")}
                  </p>
                </div>
              ) : calistirmaAni !== null ? (
                <p className="py-3 text-center text-sm text-subtle">
                  Ölçüm bekleniyor… Robot noktaya varıp probu batırdıktan sonra
                  gelen ilk değer buraya düşer.
                </p>
              ) : (
                <p className="py-3 text-center text-sm text-subtle">
                  Henüz çalıştırılmadı. Yayındaki anlık değer burada
                  gösterilmiyor — yalnızca bu komutun sonucu.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

interface OnizlemeGirdisi {
  is: SpotAction;
  x: number;
  y: number;
  yuvaAdi: string | null;
  /** Gantry Studio'daki istasyon adı — komuta giden anahtar. */
  gantryAdi: string | null;
  takili: string | null;
  seeder: { tray_x_mm: number; tray_y_mm: number; tray_z_mm: number; vacuum_pin: number };
  derinlik: number;
  suSuresi: number;
  havaSuresi: number;
  probDerinlik: number;
  bekleme: number;
  suPin: number | null;
  sensorAdi: string | null;
  /** Pinli sensörde "şu pini oku" komutu gidiyor; kanallıda ölçüm kendi geliyor. */
  sensorPinli: boolean;
}

/**
 * Sunucudaki `spot_task` ile **aynı** sırayı anlatır.
 *
 * İkisi ayrı yazıldığı için birbirinden kayma riski var; bu yüzden kurallar
 * burada da açıkça duruyor. Önizlemenin yalan söylemesi, çalıştırmadan önce
 * kontrol etme imkânını yok ederdi.
 */
function onizleme(g: OnizlemeGirdisi): string[] {
  const adimlar: string[] = [];
  const nokta = `X${g.x} Y${g.y}`;

  if (g.yuvaAdi) {
    if (g.takili && g.takili === g.gantryAdi) {
      adimlar.push(`${g.yuvaAdi} zaten takılı — uç değiştirme atlanıyor`);
    } else {
      // Diziyi biz kurmuyoruz: yandan yaklaşma, kayma ekseni, kilitleme
      // servosu ve varlık sensörü Gantry Studio'da.
      adimlar.push(`Gantry Studio "${g.gantryAdi}" ucunu taksın (${g.yuvaAdi})`);
    }
  } else {
    adimlar.push("uç değiştirme yok — yuva görevi atanmamış");
  }

  if (g.is === "sow") {
    adimlar.push(
      `tohum tepsisine in (X${g.seeder.tray_x_mm} Y${g.seeder.tray_y_mm} Z${g.seeder.tray_z_mm})`,
      `vakumu aç (pin ${g.seeder.vacuum_pin})`,
      `${nokta} noktasına git — vakum yol boyunca açık`,
      `${g.derinlik} mm derine in`,
      "vakumu kapat — tohum düşsün",
    );
  } else if (g.is === "water") {
    adimlar.push(`${nokta} noktasına git`, "toprağa in");
    if (g.suPin) {
      adimlar.push(`su pompasını aç (pin ${g.suPin})`, `${g.suSuresi} ms bekle`, "pompayı kapat");
    } else {
      adimlar.push("⚠ su pompası tanımsız — hiçbir şey akmaz");
    }
    if (g.havaSuresi > 0) adimlar.push(`hava pompası ${g.havaSuresi} ms`);
    adimlar.push("ucu güvenli yüksekliğe çek");
  } else {
    adimlar.push(`${nokta} noktasına git`, `probu ${g.probDerinlik} mm derine batır`);
    if (!g.sensorAdi) {
      adimlar.push("⚠ sensör tanımsız — okuma yok");
    } else if (g.sensorPinli) {
      adimlar.push(`${g.bekleme} ms bekle — okuma dengelensin`, `${g.sensorAdi} sensörünü oku`);
    } else {
      // Kanallı sensörde okuma istenmiyor: Arduino kendi döngüsünde
      // yayınlıyor ve ölçüm alındığı andaki konumla damgalanıyor. Bekleme
      // bu yüzden hem dengelenme hem de "en az bir ölçüm gelsin" süresi.
      adimlar.push(
        `${g.bekleme} ms bekle — ${g.sensorAdi} ölçümü kendiliğinden gelir`,
      );
    }
    adimlar.push("probu topraktan çek");
  }

  return adimlar;
}
