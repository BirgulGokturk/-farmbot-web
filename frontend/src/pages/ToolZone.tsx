/**
 * Uç değiştirme bölgesi.
 *
 * Robotun ucunu (sulama başlığı, ekim ucu, toprak sensörü…) bıraktığı ve aldığı
 * yuvaların konumları. Her yuva bir X/Y/Z noktası; robot yuvaya girmeden önce
 * "güvenli Z"ye çıkıyor ki uç toprakta sürünmesin.
 *
 * Konumlar elle yazılabildiği gibi "Buradan al" düğmesiyle robotun o anki
 * konumundan da alınabiliyor — cetvelle ölçmekten çok daha pratik.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair, MapPin, Plus, Save, Trash2, Wrench } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { readMachineConfig, type ToolSlot } from "@/lib/machine";
import { useActiveDevice } from "@/hooks/useDevice";
import { useBot, useBotPosition } from "@/store/useBot";

export default function ToolZone() {
  const { data: device } = useActiveDevice();
  const queryClient = useQueryClient();
  const position = useBotPosition();
  const locked = useBot((s) => s.status?.locked ?? false);

  const stored = readMachineConfig(device?.settings);
  const [zone, setZone] = useState(stored.tool_zone);

  useEffect(() => {
    if (device) setZone(readMachineConfig(device.settings).tool_zone);
  }, [device?.id, device?.settings]);

  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device!.id, {
        settings: { ...device!.settings, tool_zone: zone },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device!.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Uç değiştirme bölgesi kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  const goto = useMutation({
    mutationFn: async (slot: ToolSlot) => {
      /*
       * Uç yuvasına yaklaşma — PLC belgesindeki (PLC_BRIEF.md §7) sıraya birebir
       * uyar. Kural şu: **uç kafası hiçbir zaman ucun üstüne dikey inemez.**
       * Kafa uca yandan, yalnızca Y ekseni boyunca kayarak giriyor.
       *
       * X/Y hareketi her zaman güvenli yükseklikte yapılmalı; yatay hareketle
       * Z inişini birleştirmek, aradaki sıralı uçları süpürüp devirir — belgeye
       * göre bu daha önce defalarca yaşanmış.
       *
       * Adımlar ayrı komutlar olarak gidiyor; tek bir birleşik hareket, güvenli
       * rotayı Gantry Studio'nun insafına bırakırdı.
       */
      const id = device!.id;
      const approachY = slot.y - zone.approach_mm;

      // ① Yalnızca Z: güvenli yüksekliğe çık
      await api.control.moveAbsolute(id, { x: position.x, y: position.y, z: zone.safe_z });
      // ② Yalnızca X/Y: yaklaşma noktasına git, hâlâ güvenli yükseklikte
      await api.control.moveAbsolute(id, { x: slot.x, y: approachY, z: zone.safe_z });
      // ③ Yalnızca Z: ucun yanında aşağı in
      await api.control.moveAbsolute(id, { x: slot.x, y: approachY, z: slot.z });
      // ④ Yalnızca Y: ucun altına kay (X ve Z sabit)
      await api.control.moveAbsolute(id, { x: slot.x, y: slot.y, z: slot.z });
    },
    onSuccess: () =>
      toast.info(
        "Uca yaklaşıldı",
        "Kilitleme servosu PLC'de henüz bağlı değil; ucu takma adımı elle yapılmalı",
      ),
    onError: (error) => toast.error("Gidilemedi", (error as Error).message),
  });

  if (!device) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Uç Değiştirme"
          description="Uç yuvalarının konumları"
          icon={<Wrench className="size-5" />}
        />
        <Card>
          <p className="py-6 text-center text-sm text-subtle">Önce bir cihaz seçin.</p>
        </Card>
      </div>
    );
  }

  const dirty = JSON.stringify(zone) !== JSON.stringify(stored.tool_zone);

  function patchSlot(index: number, changes: Partial<ToolSlot>) {
    setZone((previous) => ({
      ...previous,
      slots: previous.slots.map((slot, i) => (i === index ? { ...slot, ...changes } : slot)),
    }));
  }

  function addSlot() {
    setZone((previous) => ({
      ...previous,
      slots: [
        ...previous.slots,
        { name: `Uç ${previous.slots.length + 1}`, x: 0, y: 0, z: 0 },
      ],
    }));
  }

  function removeSlot(index: number) {
    setZone((previous) => ({
      ...previous,
      slots: previous.slots.filter((_, i) => i !== index),
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uç Değiştirme"
        description="Uç yuvalarının konumları ve güvenli yaklaşma ayarları"
        icon={<Wrench className="size-5" />}
        actions={
          <Button
            variant="primary"
            icon={<Save className="size-4" />}
            loading={save.isPending}
            disabled={!dirty}
            onClick={() => save.mutate()}
          >
            Kaydet
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader
            title="Bölge Ayarları"
            subtitle="Tüm ölçüler milimetre"
            icon={<Crosshair className="size-4" />}
            action={dirty ? <Badge tone="warning">Kaydedilmedi</Badge> : undefined}
          />

          <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3">
            <div>
              <p className="text-sm font-medium text-content">Bölge etkin</p>
              <p className="text-xs text-subtle">Kapalıyken uç değişimi denenmez</p>
            </div>
            <Toggle
              checked={zone.enabled}
              onChange={(next) => setZone({ ...zone, enabled: next })}
              label="Bölge etkin"
            />
          </div>

          <div className="space-y-3">
            <Input
              name="safez"
              label="Güvenli Z"
              inputMode="decimal"
              hint="Yuvaya girmeden önce çıkılacak yükseklik"
              value={String(zone.safe_z)}
              onChange={(e) => setZone({ ...zone, safe_z: Number(e.target.value) || 0 })}
            />
            <Input
              name="approach"
              label="Y yaklaşma payı"
              inputMode="decimal"
              hint="Uca hangi taraftan girileceği: artı değer küçük Y'den, eksi değer büyük Y'den yaklaşır"
              value={String(zone.approach_mm)}
              onChange={(e) => setZone({ ...zone, approach_mm: Number(e.target.value) || 0 })}
            />
          </div>

          {/* Sıra ekranda yazılı olsun: bu bir tercih değil, PLC belgesindeki
              güvenlik kuralı. Uç kafası ucun üstüne dikey inemiyor. */}
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3">
            <p className="mb-1.5 text-xs font-semibold text-warning">Yaklaşma sırası</p>
            <ol className="list-inside list-decimal space-y-0.5 text-xs text-muted">
              <li>Z güvenli yüksekliğe çıkar</li>
              <li>X/Y yaklaşma noktasına gider (hâlâ yukarıda)</li>
              <li>Z ucun <em>yanında</em> aşağı iner</li>
              <li>Y boyunca ucun altına kayar</li>
            </ol>
            <p className="mt-2 text-xs text-subtle">
              Kafa ucun üstüne dikey inemez; yatay hareketle inişi birleştirmek aradaki
              uçları devirir. Kilitleme servosu PLC'de henüz bağlı olmadığı için son
              takma adımı elle yapılmalı.
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <p className="mb-1 text-xs font-medium text-content">Robotun anlık konumu</p>
            <p className="font-mono text-sm text-brand">
              X {position.x.toFixed(1)} · Y {position.y.toFixed(1)} · Z {position.z.toFixed(1)}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Uç Yuvaları"
            subtitle={`${zone.slots.length} yuva tanımlı`}
            icon={<MapPin className="size-4" />}
            action={
              <Button size="sm" icon={<Plus className="size-4" />} onClick={addSlot}>
                Yuva Ekle
              </Button>
            }
          />

          {zone.slots.length === 0 ? (
            <p className="py-8 text-center text-sm text-subtle">
              Henüz yuva yok. Robotu uç yuvasının üstüne getirip “Yuva Ekle”, sonra
              “Buradan al” deyin.
            </p>
          ) : (
            <ul className="space-y-3">
              {zone.slots.map((slot, index) => (
                <li key={index} className="rounded-xl border border-line bg-surface-2 p-3.5">
                  <div className="mb-3 flex items-center gap-2">
                    <Input
                      name={`slot-name-${index}`}
                      value={slot.name}
                      placeholder="Uç adı"
                      onChange={(e) => patchSlot(index, { name: e.target.value })}
                    />
                    <button
                      onClick={() => removeSlot(index)}
                      aria-label={`${slot.name} yuvasını sil`}
                      className="shrink-0 rounded-lg p-2 text-subtle transition-soft hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <Input
                        key={axis}
                        name={`slot-${axis}-${index}`}
                        label={axis.toUpperCase()}
                        inputMode="decimal"
                        value={String(slot[axis])}
                        onChange={(e) =>
                          patchSlot(index, { [axis]: Number(e.target.value) || 0 })
                        }
                      />
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      icon={<Crosshair className="size-4" />}
                      onClick={() => {
                        patchSlot(index, { x: position.x, y: position.y, z: position.z });
                        toast.info("Konum alındı", `${slot.name} robotun anlık konumuna ayarlandı`);
                      }}
                    >
                      Buradan al
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={locked || !zone.enabled}
                      loading={goto.isPending}
                      onClick={() => goto.mutate(slot)}
                    >
                      Yuvaya git
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {locked && (
            <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-warning">
              Robot acil durdurma kilidinde; yuvaya gitme komutu gönderilemez.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
