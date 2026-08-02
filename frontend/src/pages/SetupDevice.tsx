import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Ruler, Sprout } from "lucide-react";

import { Button, Card, Input, Select } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { BotLogo } from "@/components/layout/BotLogo";
import { api } from "@/lib/api";

/** Hazır FarmBot modelleri ve fabrika çalışma alanı ölçüleri (mm). */
const MODELS = [
  { id: "Genesis XL v1.8", label: "Genesis XL v1.8", width: 5900, length: 2900, z: 400 },
  { id: "Genesis v1.8", label: "Genesis v1.8", width: 2900, length: 1400, z: 400 },
  { id: "Express XL v1.1", label: "Express XL v1.1", width: 5900, length: 2900, z: 300 },
  { id: "Express v1.1", label: "Express v1.1", width: 2900, length: 1400, z: 300 },
  { id: "custom", label: "Özel yapım (kendi robotum)", width: 3000, length: 1500, z: 400 },
];

/**
 * İlk kurulum: hesabında henüz robot tanımlı olmayan kullanıcıya gösterilir.
 * Bu ekran olmadan yeni bir hesap boş bir panele düşerdi.
 */
export default function SetupDevice() {
  const queryClient = useQueryClient();

  const [modelId, setModelId] = useState(MODELS[0].id);
  const [name, setName] = useState("Bahçe Robotu");
  const [dims, setDims] = useState({
    width: String(MODELS[0].width),
    length: String(MODELS[0].length),
    z: String(MODELS[0].z),
  });

  function pickModel(id: string) {
    setModelId(id);
    const model = MODELS.find((m) => m.id === id);
    if (model) {
      setDims({ width: String(model.width), length: String(model.length), z: String(model.z) });
    }
  }

  const create = useMutation({
    mutationFn: () =>
      api.devices.create({
        name: name.trim() || "Bahçe Robotu",
        model: modelId === "custom" ? "Özel yapım" : modelId,
        bed_width_mm: Number(dims.width),
        bed_length_mm: Number(dims.length),
        max_z_mm: Number(dims.z),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Robot eklendi", "Artık paneli kullanmaya başlayabilirsiniz.");
    },
    onError: (error) => toast.error("Robot eklenemedi", (error as Error).message),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const invalid =
    [dims.width, dims.length, dims.z].some((v) => !v || Number.isNaN(Number(v)) || Number(v) <= 0);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <BotLogo />
        </div>

        <Card className="animate-fade-up" glow>
          <div className="mb-6 text-center">
            <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
              <Sprout className="size-7" />
            </span>
            <h1 className="font-display text-2xl font-semibold text-content">
              İlk robotunuzu tanımlayın
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              Robot henüz kurulu olmasa da paneli şimdi hazırlayabilirsiniz. Bu bilgiler
              sonradan Ayarlar'dan değiştirilebilir.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              name="name"
              label="Robot adı"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bahçe Robotu"
              required
            />

            <Select
              name="model"
              label="Model"
              value={modelId}
              onChange={(e) => pickModel(e.target.value)}
            >
              {MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </Select>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content">
                <Ruler className="size-4 text-brand" />
                Çalışma alanı (mm)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Input
                  name="width"
                  label="Genişlik (X)"
                  inputMode="numeric"
                  value={dims.width}
                  onChange={(e) => setDims({ ...dims, width: e.target.value })}
                />
                <Input
                  name="length"
                  label="Uzunluk (Y)"
                  inputMode="numeric"
                  value={dims.length}
                  onChange={(e) => setDims({ ...dims, length: e.target.value })}
                />
                <Input
                  name="z"
                  label="Derinlik (Z)"
                  inputMode="numeric"
                  value={dims.z}
                  onChange={(e) => setDims({ ...dims, z: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl bg-surface-2 p-3.5 text-xs leading-relaxed text-subtle">
              <Cpu className="mt-0.5 size-4 shrink-0 text-brand" />
              <span>
                Donanım bağlantısı ayrı bir adımdır. Robot hazır olduğunda MQTT bilgilerini
                girmeniz yeterli; panelde tasarladığınız her şey korunur.
              </span>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              disabled={invalid}
              loading={create.isPending}
            >
              Robotu Oluştur
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
