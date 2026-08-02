import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Clock,
  Home,
  Move,
  Play,
  Plus,
  Save,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { useDeviceId } from "@/hooks/useDevice";
import type { CeleryScriptStep, Sequence } from "@/lib/types";

/** Editörde eklenebilecek adım türleri. */
const STEP_TYPES = [
  {
    kind: "move_absolute",
    label: "Konuma Git",
    Icon: Move,
    build: (): CeleryScriptStep => ({
      kind: "move_absolute",
      args: {
        location: { kind: "coordinate", args: { x: 0, y: 0, z: 0 } },
        offset: { kind: "coordinate", args: { x: 0, y: 0, z: 0 } },
        speed: 100,
      },
    }),
  },
  {
    kind: "write_pin",
    label: "Pin Yaz",
    Icon: Zap,
    build: (): CeleryScriptStep => ({
      kind: "write_pin",
      args: { pin_number: 8, pin_value: 1, pin_mode: 0 },
    }),
  },
  {
    kind: "wait",
    label: "Bekle",
    Icon: Clock,
    build: (): CeleryScriptStep => ({ kind: "wait", args: { milliseconds: 5000 } }),
  },
  {
    kind: "take_photo",
    label: "Fotoğraf Çek",
    Icon: Camera,
    build: (): CeleryScriptStep => ({ kind: "take_photo", args: {} }),
  },
  {
    kind: "home",
    label: "Eve Dön",
    Icon: Home,
    build: (): CeleryScriptStep => ({ kind: "home", args: { axis: "all", speed: 100 } }),
  },
] as const;

export default function Sequences() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: sequences } = useQuery({
    queryKey: ["sequences", deviceId],
    queryFn: () => api.sequences.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const selected = sequences?.find((s) => s.id === selectedId) ?? null;

  const create = useMutation({
    mutationFn: () =>
      api.sequences.create(deviceId!, { name: "Yeni Dizi", body: [] }),
    onSuccess: (sequence) => {
      void queryClient.invalidateQueries({ queryKey: ["sequences", deviceId] });
      setSelectedId(sequence.id);
    },
    onError: (error) => toast.error("Oluşturulamadı", (error as Error).message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diziler"
        description="Robotun adım adım uygulayacağı komut dizileri"
        icon={<Workflow className="size-5" />}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="size-4" />}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Yeni Dizi
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader title="Diziler" subtitle={`${sequences?.length ?? 0} kayıt`} />
          {sequences?.length ? (
            <ul className="space-y-1.5">
              {sequences.map((sequence) => (
                <li key={sequence.id}>
                  <button
                    onClick={() => setSelectedId(sequence.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-soft",
                      selectedId === sequence.id
                        ? "bg-brand/10 text-brand"
                        : "text-muted hover:bg-surface-2 hover:text-content",
                    )}
                  >
                    <span className="text-base">{sequence.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {sequence.name}
                    </span>
                    <Badge>{sequence.body.length}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-subtle">Henüz dizi yok</p>
          )}
        </Card>

        {selected ? (
          <SequenceEditor key={selected.id} sequence={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Card>
            <EmptyState
              icon={<Workflow className="size-6" />}
              title="Bir dizi seçin"
              description="Soldan bir dizi seçin veya yeni bir tane oluşturun. Diziler takvimden zamanlanabilir."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function SequenceEditor({ sequence, onDeleted }: { sequence: Sequence; onDeleted: () => void }) {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();

  const [name, setName] = useState(sequence.name);
  const [steps, setSteps] = useState<CeleryScriptStep[]>(sequence.body);
  const [dirty, setDirty] = useState(false);

  // Başka bir dizi seçilirse formu sıfırla
  useEffect(() => {
    setName(sequence.name);
    setSteps(sequence.body);
    setDirty(false);
  }, [sequence.id, sequence.name, sequence.body]);

  const save = useMutation({
    mutationFn: () => api.sequences.update(deviceId!, sequence.id, { name, body: steps }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sequences", deviceId] });
      setDirty(false);
      toast.success("Dizi kaydedildi");
    },
    onError: (error) => toast.error("Kaydedilemedi", (error as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => api.sequences.remove(deviceId!, sequence.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sequences", deviceId] });
      onDeleted();
      toast.success("Dizi silindi");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  function mutateSteps(next: CeleryScriptStep[]) {
    setSteps(next);
    setDirty(true);
  }

  async function runNow() {
    if (!deviceId) return;
    try {
      await api.control.executeSequence(deviceId, sequence.id);
      toast.success("Dizi çalıştırılıyor", sequence.name);
    } catch (error) {
      toast.error("Çalıştırılamadı", (error as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Dizi Düzenleyici"
        subtitle={dirty ? "Kaydedilmemiş değişiklikler var" : "Tüm değişiklikler kayıtlı"}
        icon={<Workflow className="size-4" />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Play className="size-4" />} onClick={runNow}>
              Çalıştır
            </Button>
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
        label="Dizi adı"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setDirty(true);
        }}
        className="mb-5"
      />

      {/* Adım ekleme çubuğu */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STEP_TYPES.map((type) => (
          <Button
            key={type.kind}
            size="sm"
            icon={<type.Icon className="size-4" />}
            onClick={() => mutateSteps([...steps, type.build()])}
          >
            {type.label}
          </Button>
        ))}
      </div>

      {steps.length ? (
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li
              key={index}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3.5"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 font-mono text-xs text-brand">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content">{describeStep(step)}</p>
                <StepFields
                  step={step}
                  onChange={(next) =>
                    mutateSteps(steps.map((item, i) => (i === index ? next : item)))
                  }
                />
              </div>
              <button
                onClick={() => mutateSteps(steps.filter((_, i) => i !== index))}
                aria-label={`${index + 1}. adımı sil`}
                className="rounded-lg p-1.5 text-subtle transition-soft hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          icon={<Workflow className="size-6" />}
          title="Adım yok"
          description="Yukarıdaki düğmelerden adım ekleyerek diziyi oluşturun."
        />
      )}
    </Card>
  );
}

/** Adımı insan diliyle özetler. */
function describeStep(step: CeleryScriptStep): string {
  switch (step.kind) {
    case "move_absolute": {
      const location = step.args.location as { args?: { x: number; y: number; z: number } };
      const c = location?.args;
      return c ? `Konuma git: X ${c.x} · Y ${c.y} · Z ${c.z}` : "Konuma git";
    }
    case "write_pin":
      return `Pin ${step.args.pin_number} → ${step.args.pin_value ? "AÇIK" : "KAPALI"}`;
    case "wait":
      return `Bekle: ${formatDuration(Number(step.args.milliseconds ?? 0))}`;
    case "take_photo":
      return "Fotoğraf çek";
    case "home":
      return `Eve dön (${step.args.axis})`;
    default:
      return step.kind;
  }
}

/** Adımın düzenlenebilir alanları. */
function StepFields({
  step,
  onChange,
}: {
  step: CeleryScriptStep;
  onChange: (next: CeleryScriptStep) => void;
}) {
  if (step.kind === "move_absolute") {
    const location = step.args.location as { args: { x: number; y: number; z: number } };
    const update = (axis: "x" | "y" | "z", value: number) =>
      onChange({
        ...step,
        args: {
          ...step.args,
          location: { ...location, args: { ...location.args, [axis]: value } },
        },
      });

    return (
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            value={location.args[axis]}
            onChange={(value) => update(axis, value)}
          />
        ))}
      </div>
    );
  }

  if (step.kind === "write_pin") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField
          label="Pin"
          value={Number(step.args.pin_number)}
          onChange={(value) => onChange({ ...step, args: { ...step.args, pin_number: value } })}
        />
        <NumberField
          label="Değer (0/1)"
          value={Number(step.args.pin_value)}
          onChange={(value) =>
            onChange({ ...step, args: { ...step.args, pin_value: value ? 1 : 0 } })
          }
        />
      </div>
    );
  }

  if (step.kind === "wait") {
    return (
      <div className="mt-2 w-40">
        <NumberField
          label="Süre (ms)"
          value={Number(step.args.milliseconds)}
          onChange={(value) => onChange({ ...step, args: { milliseconds: value } })}
        />
      </div>
    );
  }

  return null;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.7rem] font-medium text-subtle">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 font-mono text-sm
                   text-content transition-soft focus:border-brand focus:outline-none"
      />
    </label>
  );
}
