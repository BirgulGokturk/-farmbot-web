/**
 * Uç Değiştirme & Güvenli Bölgeler.
 *
 * Gantry Studio'nun "Tool change & safe zones" ekranının karşılığı. Alan
 * adları ve hesap birebir aynı tutuldu: aynı makinenin aynı ayarı iki
 * arayüzde farklı görünürse hangisinin geçerli olduğu tartışma konusu olur ve
 * ortakla konuşurken ortak bir dil kalmaz.
 *
 * Dizinin kendisi burada değil, `lib/toolChange.ts` içinde — tablodaki
 * önizleme ile gerçekte gönderilen hareketler aynı koddan geliyor. Ayrı
 * yazılsalardı biri değişip diğeri kaldığında önizleme yalan söylerdi.
 */

import { Fragment } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Plus, Save, Trash2, Wrench } from "lucide-react";

import {
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Select,
  Toggle,
} from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  readMachineConfig,
  type RestrictedZone,
  type ToolSlot,
  type ToolZoneConfig,
} from "@/lib/machine";
import { dropSteps, pickSteps, sequenceSummary } from "@/lib/toolChange";
import { useActiveDevice } from "@/hooks/useDevice";
import { useServerForm } from "@/hooks/useServerForm";
import { useBot, useBotPosition } from "@/store/useBot";

export default function ToolZone() {
  const { data: device } = useActiveDevice();
  const queryClient = useQueryClient();
  const position = useBotPosition();
  const locked = useBot((s) => s.status?.locked ?? false);

  const stored = readMachineConfig(device?.settings);
  // Sunucudaki değer gerçekten değişmedikçe form sıfırlanmasın; nesne
  // kimliğine bakan bir efekt, araya giren her yenilemede düzenlemeyi siliyordu.
  const [zone, setZone, dirty] = useServerForm<ToolZoneConfig>(stored.tool_zone);

  const save = useMutation({
    mutationFn: (next?: ToolZoneConfig) =>
      api.devices.update(device!.id, {
        settings: { ...device!.settings, tool_zone: next ?? zone },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device!.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  /**
   * Diziyi gerçekten çalıştırır.
   *
   * Adımlar **ayrı** komutlar olarak gidiyor. Tek bir birleşik hareket,
   * güvenli rotayı Gantry Studio'nun insafına bırakırdı; oysa buradaki
   * sıralama tam olarak sıradaki uçlara çarpmamak için var.
   */
  const calistir = useMutation({
    mutationFn: async ({ slot, yon }: { slot: ToolSlot; yon: "al" | "birak" }) => {
      const id = device!.id;
      const adimlar = yon === "al" ? pickSteps(slot, zone) : dropSteps(slot, zone);

      for (const adim of adimlar) {
        if (adim.kind !== "move") {
          // Kilitleme servosu bir PLC D-yazmacıyla sürülüyor ve ajan şu an
          // PLC'ye yazmıyor. Sessizce atlamak yerine açıkça söylüyoruz.
          continue;
        }
        await api.control.moveAbsolute(id, {
          // İlk adım yalnızca Z: X/Y o an neredeyse orada kalsın
          x: adim.onlyZ ? position.x : adim.x,
          y: adim.onlyZ ? position.y : adim.y,
          z: adim.z,
          speed: Math.round(zone.change_speed),
        });
      }
      return { slot, yon };
    },
    onSuccess: ({ slot, yon }) => {
      const next = { ...zone, current_tool: yon === "al" ? slot.name : null };
      setZone(next);
      save.mutate(next);
      if (!zone.lock_servo_reg) {
        toast.warning(
          yon === "al" ? "Uca yaklaşıldı" : "Uç bırakma noktasına gidildi",
          "Kilitleme servosu yazmacı tanımlı değil (0). Kilitleme/bırakma adımı elle yapılmalı.",
        );
      } else {
        toast.success(yon === "al" ? `'${slot.name}' alındı` : `'${slot.name}' bırakıldı`);
      }
    },
    onError: (error) => toast.error("Komut gönderilemedi", (error as Error).message),
  });

  if (!device) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Uç Değiştirme"
          description="Uç yuvaları ve güvenli bölgeler"
          icon={<Wrench className="size-5" />}
        />
        <Card>
          <p className="py-6 text-center text-sm text-subtle">Önce bir cihaz seçin.</p>
        </Card>
      </div>
    );
  }

  function alan<K extends keyof ToolZoneConfig>(key: K, value: ToolZoneConfig[K]) {
    setZone((onceki) => ({ ...onceki, [key]: value }));
  }

  const takili = zone.current_tool
    ? zone.slots.find((s) => s.name === zone.current_tool)
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uç Değiştirme & Güvenli Bölgeler"
        description="Yandan yaklaşmalı uç alma, yasaklı kutular ve değiştirme alanı"
        icon={<Wrench className="size-5" />}
        actions={
          <Button
            variant="primary"
            icon={<Save className="size-4" />}
            loading={save.isPending}
            disabled={!dirty}
            onClick={() => save.mutate(undefined)}
          >
            Kaydet
          </Button>
        }
      />

      {/* ---------------- Durum şeridi ---------------- */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="text-sm">
            <span className="text-muted">Takılı uç: </span>
            <span className="font-semibold text-brand">
              {zone.current_tool ?? "yok"}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Varlık sensörü: </span>
            <span className={zone.presence_reg ? "font-semibold text-success" : "font-semibold text-warning"}>
              {zone.presence_reg ? `D${zone.presence_reg}` : "bağlı değil"}
            </span>
          </div>

          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              disabled={!takili || locked || calistir.isPending}
              loading={calistir.isPending && calistir.variables?.yon === "birak"}
              onClick={() => takili && calistir.mutate({ slot: takili, yon: "birak" })}
            >
              Takılıyı bırak
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                // Yalnızca kaydı temizler, robotu oynatmaz: uç elle
                // çıkarıldığında panelin yanlış bilgi göstermemesi için.
                const next = { ...zone, current_tool: null };
                setZone(next);
                save.mutate(next);
              }}
            >
              Durumu temizle
            </Button>
          </div>
        </div>

        {locked && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            Acil durdurma etkin — hareket komutları reddedilir.
          </p>
        )}

        {/* ---------------- Ayarlar ---------------- */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Güvenli Z (mm)" value={zone.safe_z} onChange={(v) => alan("safe_z", v)} />
          <NumberField
            label="Varlık yazmacı (D)"
            value={zone.presence_reg}
            onChange={(v) => alan("presence_reg", v)}
          />
          <NumberField
            label="Z-güvenli yazmacı (D)"
            value={zone.z_safe_reg}
            onChange={(v) => alan("z_safe_reg", v)}
          />
          <NumberField
            label="Değiştirme hızı mm/s"
            value={zone.change_speed}
            onChange={(v) => alan("change_speed", v)}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Select
            name="slide-axis"
            label="Kayma ekseni"
            value={zone.slide_axis}
            onChange={(e) => alan("slide_axis", e.target.value as "x" | "y")}
          >
            <option value="y">Y</option>
            <option value="x">X</option>
          </Select>
          <NumberField
            label="Yaklaşma ofseti"
            value={zone.approach_offset}
            onChange={(v) => alan("approach_offset", v)}
          />
          <NumberField
            label="Geçiş Z (uçları aşar)"
            value={zone.travel_z}
            onChange={(v) => alan("travel_z", v)}
          />
          <NumberField label="Kaldırma (mm)" value={zone.lift_mm} onChange={(v) => alan("lift_mm", v)} />
          <NumberField
            label="Kilit servo yazmacı (D)"
            value={zone.lock_servo_reg}
            onChange={(v) => alan("lock_servo_reg", v)}
          />
          <NumberField
            label="Kilit gecikmesi (ms)"
            value={zone.lock_delay_ms}
            onChange={(v) => alan("lock_delay_ms", v)}
          />
        </div>

        <Button
          variant="primary"
          className="mt-3"
          icon={<Save className="size-4" />}
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate(undefined)}
        >
          Kaydet
        </Button>

        {/* ---------------- Açıklama ---------------- */}
        <div className="mt-5 space-y-2 rounded-xl bg-surface-2 p-4 text-xs leading-relaxed text-muted">
          <p>
            <strong className="text-content">Yandan yaklaşmalı kilit.</strong> Kafa ucun
            üstüne dikey inemez — uca <strong>tek eksen</strong> boyunca altından kayarak
            girer (kayma ekseni: <strong>{zone.slide_axis.toUpperCase()}</strong>). Yaklaşma
            noktası, o eksende uçtan <strong>{zone.approach_offset}</strong> mm uzakta
            başlar; yalnızca o eksen değişir.
          </p>
          <p>
            <strong className="text-content">
              Sıra (sıralı uçlara asla çarpmaz):
            </strong>{" "}
            ① Z'yi Geçiş Z'ye çık → ② yaklaşma noktasının üzerine{" "}
            <em>Geçiş Z'de</em> yatayda git → ③ ucun yanında alçal → ④ altına kay
            (yalnızca {zone.slide_axis.toUpperCase()}; diğer ikisi sabit) → ⑤ servo
            kilitler → ⑥ Kaldırma kadar yüksel. Bırakma bunun tersi.
          </p>
          <p className="text-warning">
            <strong>Geçiş Z en uzun uçtan yüksek olmalı</strong> — kafa yatayda o
            yükseklikte gidiyor; alçak kalırsa aradaki uçlara çarpar.
          </p>
          <p>
            <strong className="text-content">Kilit servo yazmacı</strong>, kilitleme
            servosunu süren PLC D-yazmacı (1 = kilitle, 0 = bırak); bağlanana kadar 0
            bırakın. <strong className="text-content">Kilit gecikmesi</strong>, servoya
            komut verdikten sonra tam kilitlenip açılması için beklenecek süre
            (1000–2000 ms).
          </p>
        </div>

        <SlideDiagram zone={zone} />
      </Card>

      {/* ---------------- Yuvalar ---------------- */}
      <Card>
        <CardHeader
          title="Uç yuvaları"
          subtitle="Her satırın altında o yuvanın gerçek hareket dizisi"
          icon={<Crosshair className="size-4" />}
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="pb-2 font-medium">Uç</th>
                <th className="pb-2 font-medium">X mm</th>
                <th className="pb-2 font-medium">Y mm</th>
                <th className="pb-2 font-medium">Z kavrama</th>
                <th className="pb-2" />
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {zone.slots.map((slot, index) => (
                <Fragment key={index}>
                  <tr>
                    <td className="py-2 pr-2">
                      <Input
                        name={`ad-${index}`}
                        value={slot.name}
                        onChange={(e) => yuvaDegistir(index, { name: e.target.value })}
                      />
                    </td>
                    {(["x", "y", "z"] as const).map((eksen) => (
                      <td key={eksen} className="py-2 pr-2">
                        <NumberField
                          name={`${eksen}-${index}`}
                          value={slot[eksen]}
                          onChange={(v) => yuvaDegistir(index, { [eksen]: v })}
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={locked || calistir.isPending}
                        onClick={() => calistir.mutate({ slot, yon: "al" })}
                      >
                        Al
                      </Button>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        aria-label={`${slot.name} yuvasını sil`}
                        className="text-danger/70 transition hover:text-danger"
                        onClick={() => yuvaSil(index)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="pb-3">
                      {/* Sayıları kafadan hesaplamak zor; yanlış bir Geçiş Z'nin
                          sonucu ancak burada görülünce fark ediliyor. */}
                      <p className="break-all font-mono text-[11px] leading-relaxed text-success/80">
                        {sequenceSummary(slot, zone)}
                      </p>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <Button
          size="sm"
          className="mt-2"
          icon={<Plus className="size-4" />}
          onClick={() => yuvaEkle()}
        >
          Yuva ekle
        </Button>

        <Button
          size="sm"
          variant="secondary"
          className="mt-2 ml-2"
          icon={<Crosshair className="size-4" />}
          onClick={() =>
            yuvaEkle({
              x: Math.round(position.x),
              y: Math.round(position.y),
              z: Math.round(position.z),
            })
          }
        >
          Robotun konumundan ekle
        </Button>
      </Card>

      {/* ---------------- Yasaklı bölgeler ---------------- */}
      <Card>
        <CardHeader title="Yasaklı bölgeler" icon={<Wrench className="size-4" />} />
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Hedefi bir kutunun içine düşen her hareket, koşul doğru olmadıkça engellenir.
          Değişkenler: <code className="font-mono text-content">z x y</code>,{" "}
          <code className="font-mono text-content">prox</code> (varlık),{" "}
          <code className="font-mono text-content">tool</code>,{" "}
          <code className="font-mono text-content">safe_z</code>,{" "}
          <code className="font-mono text-content">zmax</code>. Örnekler:{" "}
          <code className="font-mono text-content">z&gt;=safe_z</code> ·{" "}
          <code className="font-mono text-content">prox</code> ·{" "}
          <code className="font-mono text-content">tool!='laser'</code> ·{" "}
          <code className="font-mono text-content">z&gt;=safe_z or prox</code>
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="pb-2 font-medium">Bölge</th>
                <th className="pb-2 font-medium">X1</th>
                <th className="pb-2 font-medium">Y1</th>
                <th className="pb-2 font-medium">X2</th>
                <th className="pb-2 font-medium">Y2</th>
                <th className="pb-2 font-medium">izin ver…</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {zone.zones.map((box, index) => (
                <tr key={index}>
                  <td className="py-2 pr-2">
                    <Input
                      name={`bolge-${index}`}
                      value={box.name}
                      onChange={(e) => bolgeDegistir(index, { name: e.target.value })}
                    />
                  </td>
                  {(["x1", "y1", "x2", "y2"] as const).map((k) => (
                    <td key={k} className="py-2 pr-2">
                      <NumberField
                        name={`${k}-${index}`}
                        value={box[k]}
                        onChange={(v) => bolgeDegistir(index, { [k]: v })}
                      />
                    </td>
                  ))}
                  <td className="py-2 pr-2">
                    <Input
                      name={`kosul-${index}`}
                      value={box.allow_if}
                      onChange={(e) => bolgeDegistir(index, { allow_if: e.target.value })}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      aria-label={`${box.name} bölgesini sil`}
                      className="text-danger/70 transition hover:text-danger"
                      onClick={() => bolgeSil(index)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={bolgeEkle}>
          Bölge ekle
        </Button>
      </Card>

      {/* ---------------- Uç değiştirme alanı ---------------- */}
      <Card>
        <CardHeader title="Uç değiştirme alanı" icon={<Wrench className="size-4" />} />
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Bu dört köşeli alanın içinde Z güvenlik kilidi <strong>devre dışı</strong>;
          böylece ucu değiştirmek için alçak Z'de hareket edebilirsiniz. Alan dışında
          X/Y hareketi hâlâ Z'nin yukarıda olmasını şart koşar.
        </p>

        <Toggle
          label="Alanı etkinleştir"
          checked={zone.change_area.enabled}
          onChange={(enabled) =>
            alan("change_area", { ...zone.change_area, enabled })
          }
        />

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {zone.change_area.corners.map((kose, index) => (
            <Fragment key={index}>
              <NumberField
                label={`X${index + 1}`}
                value={kose[0]}
                onChange={(v) => koseDegistir(index, 0, v)}
              />
              <NumberField
                label={`Y${index + 1}`}
                value={kose[1]}
                onChange={(v) => koseDegistir(index, 1, v)}
              />
            </Fragment>
          ))}
        </div>

        <Button
          variant="primary"
          className="mt-3"
          icon={<Save className="size-4" />}
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate(undefined)}
        >
          Alanı kaydet
        </Button>
      </Card>
    </div>
  );

  // ------------------------------------------------------------------ //
  // Düzenleme yardımcıları
  // ------------------------------------------------------------------ //

  function yuvaDegistir(index: number, changes: Partial<ToolSlot>) {
    setZone((onceki) => ({
      ...onceki,
      slots: onceki.slots.map((s, i) => (i === index ? { ...s, ...changes } : s)),
    }));
  }

  function yuvaEkle(konum?: { x: number; y: number; z: number }) {
    setZone((onceki) => ({
      ...onceki,
      slots: [
        ...onceki.slots,
        {
          name: `uç${onceki.slots.length + 1}`,
          x: konum?.x ?? 0,
          y: konum?.y ?? 0,
          z: konum?.z ?? 0,
        },
      ],
    }));
  }

  function yuvaSil(index: number) {
    setZone((onceki) => ({
      ...onceki,
      slots: onceki.slots.filter((_, i) => i !== index),
    }));
  }

  function bolgeDegistir(index: number, changes: Partial<RestrictedZone>) {
    setZone((onceki) => ({
      ...onceki,
      zones: onceki.zones.map((z, i) => (i === index ? { ...z, ...changes } : z)),
    }));
  }

  function bolgeEkle() {
    setZone((onceki) => ({
      ...onceki,
      zones: [
        ...onceki.zones,
        {
          name: `bölge${onceki.zones.length + 1}`,
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          allow_if: "z>=safe_z",
        },
      ],
    }));
  }

  function bolgeSil(index: number) {
    setZone((onceki) => ({
      ...onceki,
      zones: onceki.zones.filter((_, i) => i !== index),
    }));
  }

  function koseDegistir(index: number, eksen: 0 | 1, value: number) {
    setZone((onceki) => ({
      ...onceki,
      change_area: {
        ...onceki.change_area,
        corners: onceki.change_area.corners.map((k, i) =>
          i === index
            ? ((eksen === 0 ? [value, k[1]] : [k[0], value]) as [number, number])
            : k,
        ),
      },
    }));
  }
}

/**
 * Kayma ekseni görünümü.
 *
 * Yandan yaklaşmayı anlatmanın en hızlı yolu bu: kafanın uçların üstünde
 * yüksekte gidip yalnızca hedefte alçaldığını yazıyla anlatmak uzun sürüyor,
 * çizimde bir bakışta görülüyor.
 */
function SlideDiagram({ zone }: { zone: ToolZoneConfig }) {
  const eksen = zone.slide_axis.toUpperCase();
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
      <p className="mb-3 text-xs text-muted">
        Kayma ekseni görünümü ({eksen} ↔ yatay, Z ↑ yukarı) — kafa uçların üstünde{" "}
        <strong className="text-content">yüksekte</strong> gider, yalnızca hedefte alçalır
      </p>

      <div className="overflow-x-auto">
        <svg viewBox="0 0 560 190" className="h-auto w-full min-w-[30rem]" role="img"
             aria-label="Yandan yaklaşma sırası: yüksel, yatayda git, alçal, altına kay, kilitle, kaldır">
          {/* Geçiş Z hattı */}
          <line x1="20" y1="35" x2="540" y2="35" stroke="currentColor"
                className="text-warning/50" strokeWidth="1.5" strokeDasharray="6 5" />
          <text x="24" y="27" className="fill-warning text-[10px]">
            Geçiş Z — her ucun üstünde
          </text>

          {/* Zemin */}
          <line x1="20" y1="160" x2="540" y2="160" stroke="currentColor"
                className="text-line" strokeWidth="1.5" />

          {/* Yoldaki uç */}
          <rect x="150" y="95" width="45" height="65" rx="2"
                className="fill-surface stroke-line" strokeWidth="1.5" />
          <text x="172" y="176" textAnchor="middle" className="fill-subtle text-[9px]">
            yoldaki uç
          </text>

          {/* Rota */}
          <path d="M 60 35 L 330 35 L 330 130 L 385 130"
                className="fill-none stroke-success" strokeWidth="2" />

          {/* Hedef uç */}
          <rect x="360" y="130" width="50" height="30" rx="2"
                className="fill-brand/15 stroke-brand" strokeWidth="1.5" />
          <text x="385" y="176" textAnchor="middle" className="fill-brand text-[9px]">
            hedef @ kavrama Z
          </text>

          {/* Kaldırma */}
          <path d="M 385 130 L 385 108" className="fill-none stroke-success"
                strokeWidth="2" strokeDasharray="4 3" />

          {[
            { x: 60, y: 35, n: "1" },
            { x: 330, y: 35, n: "2" },
            { x: 330, y: 130, n: "3" },
            { x: 385, y: 130, n: "4" },
            { x: 385, y: 105, n: "5" },
          ].map((p) => (
            <g key={p.n}>
              <circle cx={p.x} cy={p.y} r="9" className="fill-surface stroke-success" strokeWidth="1.5" />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="fill-success text-[10px] font-bold">
                {p.n}
              </text>
            </g>
          ))}

          <text x="300" y="118" textAnchor="end" className="fill-muted text-[9px]">
            yaklaşma
          </text>
        </svg>
      </div>

      <ol className="mt-3 space-y-0.5 text-[11px] text-muted">
        <li><span className="font-bold text-success">1</span> Geçiş Z'ye yüksel</li>
        <li><span className="font-bold text-success">2</span> yüksekte git (uçları aşar)</li>
        <li><span className="font-bold text-success">3</span> yaklaşma noktasında alçal</li>
        <li><span className="font-bold text-success">4</span> altına kay (yalnızca {eksen})</li>
        <li><span className="font-bold text-success">5</span> kilitle, sonra kaldır</li>
        <li className="text-warning">BIRAKMA = tersi</li>
      </ol>
    </div>
  );
}
