import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Leaf, Search, Sun, SunDim, CloudSun } from "lucide-react";

import { Badge, Card, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useDeviceId } from "@/hooks/useDevice";
import type { PlantSpecies, SunRequirement } from "@/lib/types";

const SUN_META: Record<SunRequirement, { label: string; Icon: typeof Sun }> = {
  full: { label: "Tam güneş", Icon: Sun },
  partial: { label: "Yarı gölge", Icon: CloudSun },
  shade: { label: "Gölge", Icon: SunDim },
};

export default function Plants() {
  const deviceId = useDeviceId();
  const [search, setSearch] = useState("");

  const { data: species, isLoading } = useQuery({
    queryKey: ["species"],
    queryFn: () => api.catalog.species(),
  });

  const { data: points } = useQuery({
    queryKey: ["points", deviceId],
    queryFn: () => api.points.list(deviceId!),
    enabled: Boolean(deviceId),
  });

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
    if (!query) return species;
    return species.filter(
      (s) =>
        s.name_tr.toLocaleLowerCase("tr").includes(query) ||
        s.slug.includes(query) ||
        (s.name_en ?? "").toLowerCase().includes(query),
    );
  }, [species, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bitki Kütüphanesi"
        description="Yetiştirme bilgileri ve tür kataloğu"
        icon={<Leaf className="size-5" />}
        actions={<Badge tone="brand">{species?.length ?? 0} tür</Badge>}
      />

      <Input
        name="search"
        placeholder="Bitki adı ara…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        suffix={<Search className="size-4" />}
        className="max-w-md"
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <SpeciesCard key={item.id} species={item} planted={plantedCounts[item.id] ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function SpeciesCard({ species, planted }: { species: PlantSpecies; planted: number }) {
  const sun = SUN_META[species.sun_requirement];

  return (
    <Card className="relative overflow-hidden transition-soft hover:-translate-y-0.5 hover:shadow-float">
      {/* Türün kendi rengiyle yumuşak arka plan ışıması */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl"
        style={{ background: species.color }}
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl">{species.icon}</span>
        {planted > 0 && <Badge tone="success">{planted} ekili</Badge>}
      </div>

      <h3 className="mt-3 font-display text-lg font-semibold text-content">{species.name_tr}</h3>

      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        <sun.Icon className="size-3.5" />
        {sun.label}
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
        <Row label="Aralık" value={`${species.spread_mm} mm`} />
        <Row label="Ekim derinliği" value={`${species.sow_depth_mm} mm`} />
        <Row label="Hasat süresi" value={`${species.days_to_harvest} gün`} />
        <Row label="Günlük su" value={`${species.water_ml_per_day} ml`} />
      </dl>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-content">{value}</dd>
    </div>
  );
}
