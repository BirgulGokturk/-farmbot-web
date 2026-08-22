/**
 * Uç yuvaları.
 *
 * Ekim ve sulama komutları önce doğru ucu takıyor: tohum ucu tohumluğa
 * gitmeden, sulama ucu bitkiye gitmeden önce yuvasından alınıyor. Bunun için
 * yuvaların **nerede** olduğunu ve **hangi işe yaradığını** bilmek gerekiyor.
 *
 * Görev alanı ayrı duruyor çünkü yuvanın adına bakıp tahmin etmek kırılgan
 * olurdu: kullanıcı "Tohum ucu" da yazabilir "vakum" da "seeder" da. Görev
 * açık seçildiğinde ad tamamen serbest kalıyor.
 *
 * Yuvaya gidiş sırası burada değil, sunucuda (`commands.uc_al`) — panel ile
 * robotun aynı diziyi kullanması için. Kural: kafa ucun üstüne dikey inemez,
 * yandan ve tek eksen boyunca kayarak girer.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Plus, Trash2, Wrench } from "lucide-react";

import { Button, Card, CardHeader, Input, Select } from "@/components/ui/primitives";
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

export function UcYuvalari({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const position = useBotPosition();
  const stored = readMachineConfig(device.settings).tool_zone;
  const [zone, setZone, dirty] = useServerForm<ToolZoneConfig>(stored);

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
    setZone((onceki) => ({
      ...onceki,
      slots: [
        ...onceki.slots,
        {
          name: `İstasyon ${onceki.slots.length + 1}`,
          x: konum?.x ?? 0,
          y: konum?.y ?? 0,
          z: konum?.z ?? 0,
          role: "none",
        },
      ],
    }));
  }

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
  if (zone.slots.some((y) => y.name.trim() === "")) {
    uyarilar.push("Adı boş bırakılan yuva kaydedilmez.");
  }

  return (
    <Card>
      <CardHeader
        title="Uç Yuvaları"
        subtitle="İstasyon konumları ve görevleri"
        icon={<Wrench className="size-4" />}
      />

      <p className="mb-3 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
        Ekim ve sulama önce doğru ucu takıyor. Bunun için yuvanın konumunu ve
        görevini bilmek gerekiyor — <strong className="text-content">Z</strong>,
        ucun kavrandığı yükseklik.
      </p>

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

      <div className="space-y-3">
        {zone.slots.map((yuva, index) => (
          <div key={index} className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <Input
                name={`ad-${index}`}
                aria-label={`${index + 1}. yuvanın adı`}
                value={yuva.name}
                onChange={(e) => yuvaDegistir(index, { name: e.target.value })}
              />
              <button
                type="button"
                aria-label={`${yuva.name} yuvasını sil`}
                className="shrink-0 text-danger/70 transition hover:text-danger"
                onClick={() =>
                  setZone((o) => ({ ...o, slots: o.slots.filter((_, i) => i !== index) }))
                }
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <Select
              name={`gorev-${index}`}
              aria-label={`${yuva.name} yuvasının görevi`}
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
          </div>
        ))}

        {zone.slots.length === 0 && (
          <p className="py-4 text-center text-sm text-subtle">Tanımlı yuva yok</p>
        )}
      </div>

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

      {/* Geçiş yüksekliği, yaklaşma ofseti ve kayma ekseni Gantry Studio'da
          ayarlanıyor. Burada tekrarlamak iki ayrı doğruluk kaynağı yaratırdı. */}
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Geçiş yüksekliği, yaklaşma ofseti ve kayma ekseni{" "}
        <strong className="text-content">Hareket Kontrolü</strong> sekmesindeki
        Gantry Studio ekranından ayarlanıyor; burada yalnızca yuvaların yeri ve
        görevi var.
      </p>
    </Card>
  );
}
