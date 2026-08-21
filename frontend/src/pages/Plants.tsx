/**
 * Bitki Kütüphanesi.
 *
 * Katalog **küresel**: tüm kullanıcılar aynı türleri paylaşıyor. Bu yüzden
 * "benim çileğim 30 cm aralıkla" gibi değişiklikler katalogun kendisine değil,
 * cihazın ayarlarına yazılıyor (`device.settings.species`). Boş bırakılan alan
 * katalog değerine düşüyor, yani kullanıcı yalnızca değiştirmek istediğini
 * yazıyor ve katalog güncellenirse gerisi kendiliğinden güncel kalıyor.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudSun, Leaf, Search, Settings2, Star, Sun, SunDim } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Skeleton,
  Toggle,
} from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/NumberField";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  readMachineConfig,
  SPECIES_OVERRIDE_DEFAULTS,
  type SpeciesOverride,
} from "@/lib/machine";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { cn } from "@/lib/cn";
import type { PlantSpecies, SunRequirement } from "@/lib/types";

const SUN_META: Record<SunRequirement, { label: string; Icon: typeof Sun }> = {
  full: { label: "Tam güneş", Icon: Sun },
  partial: { label: "Yarı gölge", Icon: CloudSun },
  shade: { label: "Gölge", Icon: SunDim },
};

export default function Plants() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [yalnizFavori, setYalnizFavori] = useState(false);
  const [acikAyar, setAcikAyar] = useState<string | null>(null);

  const { data: species, isLoading } = useQuery({
    queryKey: ["species"],
    queryFn: () => api.catalog.species(),
  });

  const { data: points } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const overrides = useMemo(
    () => readMachineConfig(device?.settings).species,
    [device?.settings],
  );

  const kaydet = useMutation({
    mutationFn: (sonraki: Record<string, SpeciesOverride>) =>
      api.devices.update(device!.id, {
        settings: { ...device!.settings, species: sonraki },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device", device!.id] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  function ayarla(slug: string, degisiklik: Partial<SpeciesOverride>) {
    const mevcut = overrides[slug] ?? SPECIES_OVERRIDE_DEFAULTS;
    kaydet.mutate({ ...overrides, [slug]: { ...mevcut, ...degisiklik } });
  }

  /** Her tür için bahçede kaç adet ekili olduğunu say. */
  const plantedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const point of points ?? []) {
      if (point.species_id) counts[point.species_id] = (counts[point.species_id] ?? 0) + 1;
    }
    return counts;
  }, [points]);

  const filtered = useMemo(() => {
    if (!species) return [];
    const query = search.trim().toLocaleLowerCase("tr");

    const eslesen = species.filter((s) => {
      if (yalnizFavori && !overrides[s.slug]?.favorite) return false;
      if (!query) return true;
      return (
        s.name_tr.toLocaleLowerCase("tr").includes(query) ||
        s.slug.includes(query) ||
        (s.name_en ?? "").toLowerCase().includes(query)
      );
    });

    // Favoriler başa: kullanıcı kendi seçtiklerini her seferinde aramasın
    return eslesen.sort((a, b) => {
      const fa = overrides[a.slug]?.favorite ? 0 : 1;
      const fb = overrides[b.slug]?.favorite ? 0 : 1;
      return fa - fb || a.name_tr.localeCompare(b.name_tr, "tr");
    });
  }, [species, search, yalnizFavori, overrides]);

  const favoriSayisi = Object.values(overrides).filter((o) => o.favorite).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bitki Kütüphanesi"
        description="Yetiştirme bilgileri ve türe özel ayarlar"
        icon={<Leaf className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            {favoriSayisi > 0 && <Badge tone="warning">{favoriSayisi} favori</Badge>}
            <Badge tone="brand">{species?.length ?? 0} tür</Badge>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          name="search"
          placeholder="Bitki adı ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          suffix={<Search className="size-4" />}
          className="max-w-md flex-1"
        />
        <Toggle
          label="Yalnızca favoriler"
          checked={yalnizFavori}
          onChange={setYalnizFavori}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-subtle">
            {yalnizFavori
              ? "Henüz favori bitkiniz yok. Kartlardaki yıldıza basarak ekleyin."
              : "Aramanıza uyan bitki yok."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <SpeciesCard
              key={item.id}
              species={item}
              planted={plantedCounts[item.id] ?? 0}
              override={overrides[item.slug] ?? SPECIES_OVERRIDE_DEFAULTS}
              ayarAcik={acikAyar === item.slug}
              onAyarAc={() => setAcikAyar(acikAyar === item.slug ? null : item.slug)}
              onChange={(d) => ayarla(item.slug, d)}
              kaydediliyor={kaydet.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpeciesCard({
  species,
  planted,
  override,
  ayarAcik,
  onAyarAc,
  onChange,
  kaydediliyor,
}: {
  species: PlantSpecies;
  planted: number;
  override: SpeciesOverride;
  ayarAcik: boolean;
  onAyarAc: () => void;
  onChange: (degisiklik: Partial<SpeciesOverride>) => void;
  kaydediliyor: boolean;
}) {
  const sun = SUN_META[species.sun_requirement];

  // Geçerli değer: kullanıcı yazdıysa onunki, yoksa katalog
  const aralik = override.spread_mm ?? species.spread_mm;
  const derinlik = override.sow_depth_mm ?? species.sow_depth_mm;
  const su = override.water_ml_per_day ?? species.water_ml_per_day;
  const hasat = override.days_to_harvest ?? species.days_to_harvest;

  const degistirilmis =
    override.spread_mm !== null ||
    override.sow_depth_mm !== null ||
    override.water_ml_per_day !== null ||
    override.days_to_harvest !== null;

  return (
    <Card className="relative overflow-hidden transition-soft hover:-translate-y-0.5 hover:shadow-float">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl"
        style={{ background: species.color }}
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl">{species.icon}</span>

        <div className="flex items-center gap-1">
          {planted > 0 && <Badge tone="success">{planted} ekili</Badge>}

          <button
            type="button"
            aria-label={
              override.favorite
                ? `${species.name_tr} favorilerden çıkar`
                : `${species.name_tr} favorilere ekle`
            }
            aria-pressed={override.favorite}
            disabled={kaydediliyor}
            className={cn(
              "rounded-lg p-1.5 transition",
              override.favorite
                ? "text-warning hover:bg-warning/10"
                : "text-subtle hover:bg-surface-2 hover:text-muted",
            )}
            onClick={() => onChange({ favorite: !override.favorite })}
          >
            <Star className={cn("size-4", override.favorite && "fill-current")} />
          </button>

          <button
            type="button"
            aria-label={`${species.name_tr} ayarları`}
            aria-expanded={ayarAcik}
            className={cn(
              "rounded-lg p-1.5 transition",
              ayarAcik ? "bg-brand/12 text-brand" : "text-subtle hover:bg-surface-2 hover:text-muted",
            )}
            onClick={onAyarAc}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </div>

      <h3 className="mt-3 font-display text-lg font-semibold text-content">
        {species.name_tr}
      </h3>

      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        <sun.Icon className="size-3.5" />
        {sun.label}
        {degistirilmis && <Badge tone="brand">özelleştirildi</Badge>}
      </div>

      {ayarAcik ? (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <p className="text-xs leading-relaxed text-subtle">
            Boş bırakılan alan katalog değerini kullanır. Değişiklikler yalnızca
            <strong> bu robota</strong> ait; katalog herkesle paylaşılıyor.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Yayılma çapı (mm)"
              value={aralik}
              min={1}
              commitOn="blur"
              onChange={(v) => onChange({ spread_mm: v })}
            />
            <NumberField
              label="Ekim derinliği (mm)"
              value={derinlik}
              min={0}
              commitOn="blur"
              onChange={(v) => onChange({ sow_depth_mm: v })}
            />
            <NumberField
              label="Günlük su (ml)"
              value={su}
              min={0}
              commitOn="blur"
              onChange={(v) => onChange({ water_ml_per_day: v })}
            />
            <NumberField
              label="Hasat (gün)"
              value={hasat}
              min={1}
              commitOn="blur"
              onChange={(v) => onChange({ days_to_harvest: v })}
            />
          </div>

          {degistirilmis && (
            <Button
              size="sm"
              fullWidth
              onClick={() =>
                onChange({
                  spread_mm: null,
                  sow_depth_mm: null,
                  water_ml_per_day: null,
                  days_to_harvest: null,
                })
              }
            >
              Katalog değerlerine dön
            </Button>
          )}
        </div>
      ) : (
        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
          <Row label="Yayılma çapı" value={`${aralik} mm`} ozel={override.spread_mm !== null} />
          <Row
            label="Ekim derinliği"
            value={`${derinlik} mm`}
            ozel={override.sow_depth_mm !== null}
          />
          <Row label="Hasat süresi" value={`${hasat} gün`} ozel={override.days_to_harvest !== null} />
          <Row label="Günlük su" value={`${su} ml`} ozel={override.water_ml_per_day !== null} />
        </dl>
      )}
    </Card>
  );
}

function Row({ label, value, ozel }: { label: string; value: string; ozel?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-mono", ozel ? "text-brand" : "text-content")}>{value}</dd>
    </div>
  );
}
