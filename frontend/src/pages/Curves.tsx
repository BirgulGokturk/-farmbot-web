import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, LineChart, Move3d, Plus, Ruler, Save, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { CURVE_META, CurveEditor } from "@/components/curves/CurveEditor";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDeviceId } from "@/hooks/useDevice";
import type { Curve, CurveType } from "@/lib/types";

const TYPE_ICON: Record<CurveType, typeof Droplets> = {
  water: Droplets,
  spread: Ruler,
  height: Move3d,
};

/** Yeni eğri oluştururken kullanılan makul başlangıç şekli. */
const TEMPLATES: Record<CurveType, Record<string, number>> = {
  water: { "1": 60, "20": 220, "50": 420, "90": 520 },
  spread: { "1": 30, "20": 120, "50": 300, "90": 420 },
  height: { "1": 20, "20": 160, "50": 480, "90": 620 },
};

export default function Curves() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newType, setNewType] = useState<CurveType>("water");

  const { data: curves, isLoading } = useQuery({
    queryKey: ["curves", deviceId],
    queryFn: () => api.catalog.curves(deviceId!),
    enabled: Boolean(deviceId),
  });

  const selected = curves?.find((c) => c.id === selectedId) ?? null;

  // İlk eğri gelince otomatik seç — boş sağ panel görünmesin
  useEffect(() => {
    if (!selectedId && curves?.length) setSelectedId(curves[0].id);
  }, [curves, selectedId]);

  const create = useMutation({
    mutationFn: () =>
      api.catalog.createCurve(deviceId!, {
        name: `${CURVE_META[newType].label} eğrisi`,
        curve_type: newType,
        data: TEMPLATES[newType],
      }),
    onSuccess: (curve) => {
      void queryClient.invalidateQueries({ queryKey: ["curves", deviceId] });
      setSelectedId(curve.id);
      toast.success("Eğri oluşturuldu");
    },
    onError: (error) => toast.error("Oluşturulamadı", (error as Error).message),
  });

  const grouped = useMemo(() => {
    const map: Record<CurveType, Curve[]> = { water: [], spread: [], height: [] };
    for (const curve of curves ?? []) map[curve.curve_type]?.push(curve);
    return map;
  }, [curves]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Büyüme Eğrileri"
        description="Bitkinin yaşına göre su, yayılma ve boy değerleri"
        icon={<LineChart className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Select
              name="type"
              aria-label="Eklenecek eğri türü"
              value={newType}
              onChange={(e) => setNewType(e.target.value as CurveType)}
              className="h-8 w-36 text-xs"
            >
              {(Object.keys(CURVE_META) as CurveType[]).map((type) => (
                <option key={type} value={type}>
                  {CURVE_META[type].label}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-4" />}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              Yeni Eğri
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader title="Eğriler" subtitle={`${curves?.length ?? 0} kayıt`} />
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : curves?.length ? (
            <div className="space-y-4">
              {(Object.keys(grouped) as CurveType[]).map((type) =>
                grouped[type].length ? (
                  <div key={type}>
                    <p className="mb-1.5 px-1 text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
                      {CURVE_META[type].label}
                    </p>
                    <ul className="space-y-1">
                      {grouped[type].map((curve) => {
                        const Icon = TYPE_ICON[curve.curve_type];
                        return (
                          <li key={curve.id}>
                            <button
                              onClick={() => setSelectedId(curve.id)}
                              className={cn(
                                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-soft",
                                selectedId === curve.id
                                  ? "bg-brand/10 text-brand"
                                  : "text-muted hover:bg-surface-2 hover:text-content",
                              )}
                            >
                              <Icon className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {curve.name}
                              </span>
                              <Badge>{Object.keys(curve.data).length}</Badge>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-subtle">Henüz eğri yok</p>
          )}
        </Card>

        {selected ? (
          <CurvePanel key={selected.id} curve={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Card>
            <EmptyState
              icon={<LineChart className="size-6" />}
              title="Bir eğri seçin"
              description="Eğriler, bitkinin yaşına göre ne kadar su istediğini ve ne kadar yayılacağını belirler. Tarla Tasarımcısı'ndaki zaman yolculuğu bu eğrilerden beslenir."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function CurvePanel({ curve, onDeleted }: { curve: Curve; onDeleted: () => void }) {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();

  const [name, setName] = useState(curve.name);
  const [data, setData] = useState<Record<string, number>>(curve.data);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(curve.name);
    setData(curve.data);
    setDirty(false);
  }, [curve.id, curve.name, curve.data]);

  const save = useMutation({
    mutationFn: () => api.catalog.updateCurve(deviceId!, curve.id, { name, data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["curves", deviceId] });
      setDirty(false);
      toast.success("Eğri kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => api.catalog.removeCurve(deviceId!, curve.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["curves", deviceId] });
      onDeleted();
      toast.success("Eğri silindi");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  const meta = CURVE_META[curve.curve_type];
  const days = Object.keys(data).map(Number);
  const maxDay = Math.max(120, ...(days.length ? days : [0]));

  return (
    <Card>
      <CardHeader
        title={meta.label + " eğrisi"}
        subtitle={dirty ? "Kaydedilmemiş değişiklikler var" : "Tüm değişiklikler kayıtlı"}
        icon={<LineChart className="size-4" />}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<Save className="size-4" />}
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Kaydet
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-4" />}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Sil
            </Button>
          </div>
        }
      />

      <Input
        name="name"
        label="Eğri adı"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setDirty(true);
        }}
        className="mb-4"
      />

      <CurveEditor
        type={curve.curve_type}
        data={data}
        maxDay={maxDay}
        onChange={(next) => {
          setData(next);
          setDirty(true);
        }}
      />

      <p className="mt-4 rounded-xl bg-surface-2 p-3.5 text-xs leading-relaxed text-subtle">
        Yatay eksen bitkinin <strong className="text-muted">ekimden sonraki yaşı</strong>,
        dikey eksen <strong className="text-muted">{meta.unit}</strong> değeridir. Ara günler
        doğrusal olarak hesaplanır. Bu eğriyi bir bitkiye bağladığınızda tasarımcıdaki zaman
        kaydırıcısı bitkiyi bu şekle göre büyütür.
      </p>
    </Card>
  );
}
