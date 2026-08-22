/**
 * Uç yuvaları.
 *
 * Ekim ve sulama komutları önce doğru ucu takıyor: tohum ucu tohumluğa
 * gitmeden, sulama ucu bitkiye gitmeden önce yuvasından alınıyor. Bunun için
 * yuvaların **nerede** olduğunu ve **hangi işe yaradığını** bilmek gerekiyor.
 *
 * İş bölümü
 * ---------
 * Koordinatlar Gantry Studio'da tanımlı (Hareket Kontrolü → Tools) ve mekanik
 * oradan doğrulanıyor. Aynı sayıları burada ikinci kez elle girmek, er ya da
 * geç birinin diğerinden kayması demekti; robot da hangisine göre hareket
 * ettiğini söylemezdi. Bu yüzden:
 *
 *   Gantry Studio → istasyonun **yeri**  (ad, X, Y, Z)
 *   Bu kart       → istasyonun **görevi** ve okunur adı
 *
 * Görev bilgisi Gantry Studio'da yok; oraya eklemek istemiyoruz, dokunulmaması
 * gereken kısım orası.
 *
 * `name` bir anahtar: uç alma komutu ve `current_tool` karşılaştırması onun
 * üzerinden yürüyor, o yüzden düzenlenemiyor. Görünen ad ayrı bir alan.
 *
 * Gantry Studio'ya ulaşılamazsa kart elle girme kipine düşüyor — ayar sayfası
 * ortağın sunucusu kapalı diye kullanılamaz hâle gelmesin.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Link2, Plus, RefreshCw, Trash2, Wrench } from "lucide-react";

import { Badge, Button, Card, CardHeader, Input, Select } from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  readMachineConfig,
  type ToolRole,
  type ToolSlot,
  type ToolZoneConfig,
} from "@/lib/machine";
import { useServerForm } from "@/hooks/useServerForm";
import { useBotPosition } from "@/store/useBot";
import type { Device } from "@/lib/types";

/** Sunucudaki `slots[:12]` sınırı — burada da uygulanıyor. */
const MAX_YUVA = 12;

const GOREVLER: { value: ToolRole; label: string }[] = [
  { value: "none", label: "Görev yok" },
  { value: "seeder", label: "Tohum ucu (vakum)" },
  { value: "waterer", label: "Sulama ucu" },
  { value: "soil_probe", label: "Toprak nemi probu" },
];

/**
 * Eşitlemede görev ve ad tahmini — sahadaki düzen.
 *
 * Yalnızca **görevi atanmamış** (`none`) yuvalara uygulanıyor: atanmış bir
 * görev asla ezilmiyor. "Görev yok", kullanıcının verdiği bir cevap değil,
 * cevabın yokluğu — ilk eşitlemeden sonra hâlâ boş kalsaydı ekim ucu almadan
 * yola çıkardı ve sebebi görünmezdi. Yanlışsa açılır listeden değiştiriliyor,
 * bir daha da değişmiyor.
 */
const VARSAYILAN_GOREV: Record<string, ToolRole> = {
  tool1: "seeder",
  tool2: "soil_probe",
  tool3: "waterer",
};

/** Aynı mantık okunur ad için: kullanıcı kendi adını yazdıysa dokunulmuyor. */
const VARSAYILAN_ETIKET: Record<string, string> = {
  tool1: "Tohum Ucu",
  tool2: "Toprak Probu",
  tool3: "Sulama Ucu",
};

export function UcYuvalari({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const position = useBotPosition();
  const stored = readMachineConfig(device.settings).tool_zone;
  const [zone, setZone, dirty] = useServerForm<ToolZoneConfig>(stored);

  const { data: gantry, isLoading: gantryYukleniyor, refetch } = useQuery({
    queryKey: ["gantry-tools"],
    queryFn: () => api.gantry.tools(),
    // Ortağın arayüzünde istasyon eklendiğinde burada da görünsün; pencereye
    // her dönüşte yeniden sormak yeterince taze ve ucuz.
    staleTime: 30_000,
  });

  const bagli = Boolean(gantry?.available);
  const gantryYuvalari = gantry?.slots ?? [];

  const kaydet = useMutation({
    mutationFn: (next?: ToolZoneConfig) =>
      api.devices.update(device.id, {
        settings: { ...device.settings, tool_zone: next ?? zone },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Uç yuvaları kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  function yuvaDegistir(index: number, degisiklik: Partial<ToolSlot>) {
    setZone((onceki) => ({
      ...onceki,
      slots: onceki.slots.map((y, i) => (i === index ? { ...y, ...degisiklik } : y)),
    }));
  }

  function yuvaEkle(konum?: { x: number; y: number; z: number }) {
    setZone((onceki) => {
      const ad = `istasyon${onceki.slots.length + 1}`;
      return {
        ...onceki,
        slots: [
          ...onceki.slots,
          {
            name: ad,
            label: `İstasyon ${onceki.slots.length + 1}`,
            x: konum?.x ?? 0,
            y: konum?.y ?? 0,
            z: konum?.z ?? 0,
            role: "none",
          },
        ],
      };
    });
  }

  /**
   * Gantry Studio'daki listeyi buraya yansıtır.
   *
   * Ada göre eşleşiyor: var olan yuvanın **koordinatı** tazeleniyor, görevi ve
   * okunur adı korunuyor. Yeni istasyon geldiğinde varsayılan görevi atanıyor.
   * Gantry Studio'dan silinmiş istasyon buradan da düşüyor — kalsaydı ekim
   * komutu var olmayan bir yuvaya giderdi.
   */
  const hedefYuvalar: ToolSlot[] = gantryYuvalari.slice(0, MAX_YUVA).map((g) => {
    const eski = zone.slots.find((y) => y.name === g.name);
    const anahtar = g.name.toLowerCase();
    // Kullanıcının kendi adı `name`'den farklıysa vardır; eşitse henüz
    // adlandırmamış demektir ve varsayılan okunur ad devreye giriyor.
    const kendiAdi = eski?.label && eski.label !== eski.name;
    return {
      name: g.name,
      label: kendiAdi ? eski!.label : VARSAYILAN_ETIKET[anahtar] ?? g.name,
      x: g.x,
      y: g.y,
      z: g.z,
      role: eski && eski.role !== "none" ? eski.role : VARSAYILAN_GOREV[anahtar] ?? "none",
    };
  });

  function esitle() {
    const next: ToolZoneConfig = {
      ...zone,
      slots: hedefYuvalar,
      current_tool: gantry?.current_tool ?? zone.current_tool,
    };
    setZone(next);
    kaydet.mutate(next);
  }

  /*
   * Kaç yuva eşitlemeden etkilenecek?
   *
   * Yalnızca koordinat farkına bakmak yetmiyordu: koordinatlar tutuyor ama
   * görev hiç atanmamışsa da eşitlemenin yapacağı bir iş var ve düğme kapalı
   * kalırsa kullanıcı onu yapamaz. Bu yüzden ölçüt "eşitleme sonrası liste,
   * şimdikinden farklı mı" — düğmenin açık olduğu durum ile gerçekten bir şey
   * değiştiği durum aynı şey oluyor.
   */
  const farkli = bagli
    ? hedefYuvalar.filter((h) => {
        const y = zone.slots.find((s) => s.name === h.name);
        // Alan alan karşılaştırma: JSON.stringify anahtar sırasına duyarlı ve
        // iki nesne farklı yerlerde kuruluyor.
        return (
          !y ||
          y.x !== h.x ||
          y.y !== h.y ||
          y.z !== h.z ||
          y.role !== h.role ||
          y.label !== h.label
        );
      }).length +
      zone.slots.filter((y) => !gantryYuvalari.some((g) => g.name === y.name)).length
    : 0;

  // Sunucu ilk 12 yuvayı saklıyor; fazlası sessizce düşerdi.
  const dolu = zone.slots.length >= MAX_YUVA;

  // Sessiz kalıp komutun çalışma anında düşmesini beklemek yerine burada
  // söylüyoruz: yuva tanımı ile komutun aradığı görev eşleşmezse ekim/sulama
  // ucu almadan yola çıkar.
  const uyarilar: string[] = [];
  const gorevSayisi = (rol: ToolRole) => zone.slots.filter((y) => y.role === rol).length;

  if (gorevSayisi("seeder") === 0) {
    uyarilar.push("Tohum ucu atanmadı — ekim, uç almadan doğrudan tohumluğa gider.");
  }
  if (gorevSayisi("waterer") === 0) {
    uyarilar.push("Sulama ucu atanmadı — sulama, uç almadan bitkiye gider.");
  }
  for (const g of ["seeder", "waterer", "soil_probe"] as const) {
    if (gorevSayisi(g) > 1) {
      const ad = GOREVLER.find((x) => x.value === g)!.label;
      uyarilar.push(`Birden fazla yuvaya "${ad}" verilmiş; ilki kullanılır.`);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Uç Yuvaları"
        subtitle="İstasyon konumları ve görevleri"
        icon={<Wrench className="size-4" />}
        action={
          bagli ? (
            <Badge tone={farkli ? "warning" : "success"} dot>
              {farkli ? `${farkli} fark` : "Eşitlendi"}
            </Badge>
          ) : (
            <Badge tone="neutral">Elle</Badge>
          )
        }
      />

      {/* --- Kaynak şeridi --- */}
      {bagli ? (
        <div className="mb-3 rounded-xl bg-surface-2 p-3">
          <p className="flex items-center gap-1.5 text-xs leading-relaxed text-subtle">
            <Link2 className="size-3.5 shrink-0 text-brand" />
            <span>
              Koordinatlar <strong className="text-content">Gantry Studio</strong>'dan
              geliyor (Hareket Kontrolü → Tools). Konumu oradan değiştirin;
              burada görev ve görünen ad var.
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-subtle">
            {gantry?.travel_z != null && <span>geçiş Z {gantry.travel_z}</span>}
            {gantry?.safe_z != null && <span>güvenli Z {gantry.safe_z}</span>}
            {gantry?.slide_axis && <span>kayma {gantry.slide_axis}</span>}
            {gantry?.approach != null && <span>yaklaşma {gantry.approach}</span>}
            {gantry?.lift != null && <span>kaldırma {gantry.lift}</span>}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              icon={<RefreshCw className="size-3.5" />}
              loading={gantryYukleniyor}
              onClick={() => void refetch()}
            >
              Yeniden oku
            </Button>
            <Button
              size="sm"
              variant={farkli ? "primary" : "secondary"}
              disabled={farkli === 0}
              loading={kaydet.isPending}
              onClick={esitle}
            >
              {farkli ? `Eşitle (${farkli})` : "Fark yok"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-3 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          {gantry?.reason ?? "Gantry Studio okunuyor…"} Koordinatları şimdilik
          elle girebilirsiniz; bağlantı kurulduğunda oradan eşitlenir.
        </p>
      )}

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">Takılı uç:</span>
        <span className="font-semibold text-brand">{zone.current_tool ?? "yok"}</span>
        {zone.current_tool && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              // Yalnızca kaydı temizler, robotu oynatmaz: uç elle
              // çıkarıldığında panelin yanlış bilgi göstermemesi için.
              const next = { ...zone, current_tool: null };
              setZone(next);
              kaydet.mutate(next);
            }}
          >
            Durumu temizle
          </Button>
        )}
      </div>

      {/* --- Yuvalar --- */}
      <div className="space-y-3">
        {zone.slots.map((yuva, index) => {
          const kaynak = gantryYuvalari.find((g) => g.name === yuva.name);
          const kopmus = bagli && !kaynak;

          return (
            <div
              key={yuva.name}
              className="rounded-xl border border-line bg-surface-2 p-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  name={`etiket-${index}`}
                  aria-label={`${yuva.name} için görünen ad`}
                  value={yuva.label}
                  onChange={(e) => yuvaDegistir(index, { label: e.target.value })}
                />
                {!bagli && (
                  <button
                    type="button"
                    aria-label={`${yuva.label} yuvasını sil`}
                    className="shrink-0 text-danger/70 transition hover:text-danger"
                    onClick={() =>
                      setZone((o) => ({
                        ...o,
                        slots: o.slots.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-subtle">
                Gantry adı: {yuva.name}
                {kopmus && (
                  <span className="ml-2 text-warning">
                    · Gantry Studio'da yok — Eşitle bu yuvayı kaldırır
                  </span>
                )}
              </p>

              <Select
                name={`gorev-${index}`}
                aria-label={`${yuva.label} yuvasının görevi`}
                className="mt-2"
                value={yuva.role}
                onChange={(e) => yuvaDegistir(index, { role: e.target.value as ToolRole })}
              >
                {GOREVLER.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </Select>

              {bagli ? (
                // Bağlıyken düzenlenebilir alan koymuyoruz: yazılan değer ilk
                // eşitlemede sessizce geri alınırdı, bu da en can sıkıcı
                // arayüz hatası olurdu.
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  {(["x", "y", "z"] as const).map((eksen) => (
                    <div
                      key={eksen}
                      className="rounded-lg bg-surface-3 px-2.5 py-1.5 text-center"
                    >
                      <dt className="text-[10px] uppercase tracking-wider text-subtle">
                        {eksen}
                      </dt>
                      <dd className="font-mono text-sm text-content">
                        {kaynak ? kaynak[eksen] : yuva[eksen]}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(["x", "y", "z"] as const).map((eksen) => (
                      <NumberField
                        key={eksen}
                        name={`${eksen}-${index}`}
                        label={eksen.toUpperCase()}
                        value={yuva[eksen]}
                        onChange={(v) => yuvaDegistir(index, { [eksen]: v })}
                      />
                    ))}
                  </div>
                  <Button
                    size="sm"
                    fullWidth
                    className="mt-2"
                    icon={<Crosshair className="size-3.5" />}
                    onClick={() =>
                      yuvaDegistir(index, {
                        x: Math.round(position.x),
                        y: Math.round(position.y),
                        z: Math.round(position.z),
                      })
                    }
                  >
                    Robotun şu anki konumunu al
                  </Button>
                </>
              )}
            </div>
          );
        })}

        {zone.slots.length === 0 && (
          <p className="py-4 text-center text-sm text-subtle">
            {bagli && gantryYuvalari.length > 0
              ? `Gantry Studio'da ${gantryYuvalari.length} istasyon var — Eşitle'ye basın.`
              : "Tanımlı yuva yok"}
          </p>
        )}
      </div>

      {!bagli && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            disabled={dolu}
            onClick={() => yuvaEkle()}
          >
            Boş yuva ekle
          </Button>
          <Button
            size="sm"
            icon={<Crosshair className="size-4" />}
            disabled={dolu}
            onClick={() =>
              yuvaEkle({
                x: Math.round(position.x),
                y: Math.round(position.y),
                z: Math.round(position.z),
              })
            }
          >
            Bu konumdan ekle
          </Button>
        </div>
      )}

      {uyarilar.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          {uyarilar.map((uyari) => (
            <li key={uyari}>{uyari}</li>
          ))}
        </ul>
      )}

      <Button
        variant="primary"
        fullWidth
        className="mt-3"
        disabled={!dirty}
        loading={kaydet.isPending}
        onClick={() => kaydet.mutate(undefined)}
      >
        Kaydet
      </Button>
    </Card>
  );
}
