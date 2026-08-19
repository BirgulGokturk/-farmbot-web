import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Plus, Trash2, WifiOff } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  Toggle,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useDeviceId } from "@/hooks/useDevice";
import type { AlertComparison, AlertKind } from "@/lib/types";

export function AlertRules() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: rules } = useQuery({
    queryKey: ["alert-rules", deviceId],
    queryFn: () => api.alerts.rules(deviceId!),
    enabled: Boolean(deviceId),
  });

  const { data: sensors } = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => api.hardware.sensors(deviceId!),
    enabled: Boolean(deviceId),
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.alerts.updateRule(deviceId!, id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-rules", deviceId] }),
    onError: (error) => toast.error("Güncellenemedi", (error as Error).message),
  });

  const removeRule = useMutation({
    mutationFn: (id: string) => api.alerts.removeRule(deviceId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["alert-rules", deviceId] });
      toast.success("Kural silindi");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  return (
    <Card>
      <CardHeader
        title="Uyarı Kuralları"
        subtitle="Eşik aşıldığında veya robot sustuğunda haber ver"
        icon={<BellRing className="size-4" />}
        action={
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Kapat" : "Yeni Kural"}
          </Button>
        }
      />

      {showForm && (
        <RuleForm
          // Takılı olmayan sensöre kural kurulamasın: boştaki pinin gürültüsü
          // eşiği aşıp durmadan sahte uyarı üretirdi.
          sensors={(sensors ?? []).filter((sensor) => sensor.installed)}
          onCreated={() => {
            setShowForm(false);
            void queryClient.invalidateQueries({ queryKey: ["alert-rules", deviceId] });
          }}
        />
      )}

      {rules?.length ? (
        <ul className="space-y-2.5">
          {rules.map((rule) => {
            const sensor = sensors?.find((s) => s.id === rule.sensor_id);
            return (
              <li key={rule.id} className="rounded-xl bg-surface-2 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-content">{rule.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
                      {rule.kind === "device_offline" ? (
                        <>
                          <WifiOff className="size-3" />
                          {rule.offline_minutes} dk sessizlik
                        </>
                      ) : (
                        <>
                          {sensor?.icon ?? "📊"} {sensor?.label ?? "Sensör"}{" "}
                          {rule.comparison === "below" ? "<" : ">"} {rule.threshold}
                          {sensor?.unit}
                        </>
                      )}
                    </p>
                  </div>
                  <Toggle
                    checked={rule.enabled}
                    onChange={(enabled) => toggleRule.mutate({ id: rule.id, enabled })}
                    label={`${rule.name} etkin mi`}
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <Badge tone={rule.last_triggered_at ? "warning" : "neutral"}>
                    {rule.last_triggered_at
                      ? `Son: ${formatRelative(rule.last_triggered_at)}`
                      : "Hiç tetiklenmedi"}
                  </Badge>
                  <button
                    onClick={() => removeRule.mutate(rule.id)}
                    aria-label="Kuralı sil"
                    className="rounded-lg p-1.5 text-subtle transition-soft hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        !showForm && (
          <p className="py-4 text-center text-sm text-subtle">
            Henüz kural yok. Örnek: “Toprak nemi %20'nin altına düşerse uyar.”
          </p>
        )
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- //

function RuleForm({
  sensors,
  onCreated,
}: {
  sensors: import("@/lib/types").Sensor[];
  onCreated: () => void;
}) {
  const deviceId = useDeviceId();

  const [kind, setKind] = useState<AlertKind>("sensor_threshold");
  const [name, setName] = useState("Toprak kuruyor");
  const [sensorId, setSensorId] = useState(sensors[0]?.id ?? "");
  const [comparison, setComparison] = useState<AlertComparison>("below");
  const [threshold, setThreshold] = useState("20");
  const [offlineMinutes, setOfflineMinutes] = useState("15");
  const [cooldown, setCooldown] = useState("60");

  const create = useMutation({
    mutationFn: () =>
      api.alerts.createRule(deviceId!, {
        name,
        kind,
        sensor_id: kind === "sensor_threshold" ? sensorId : null,
        comparison,
        threshold: kind === "sensor_threshold" ? Number(threshold) : null,
        offline_minutes: Number(offlineMinutes),
        cooldown_minutes: Number(cooldown),
      }),
    onSuccess: () => {
      toast.success("Kural oluşturuldu");
      onCreated();
    },
    onError: (error) => toast.error("Oluşturulamadı", (error as Error).message),
  });

  const canSubmit =
    name.trim().length > 0 &&
    (kind === "device_offline" || (sensorId && threshold !== "" && !Number.isNaN(Number(threshold))));

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-line bg-surface-2 p-3.5">
      <Select
        name="kind"
        label="Kural türü"
        value={kind}
        onChange={(event) => {
          const next = event.target.value as AlertKind;
          setKind(next);
          setName(next === "device_offline" ? "Robot sustu" : "Toprak kuruyor");
        }}
      >
        <option value="sensor_threshold">Sensör eşiği</option>
        <option value="device_offline">Robot çevrimdışı</option>
      </Select>

      <Input name="ruleName" label="Uyarı adı" value={name} onChange={(e) => setName(e.target.value)} />

      {kind === "sensor_threshold" ? (
        <>
          {sensors.length === 0 ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Önce bir sensör tanımlamalısınız.
            </p>
          ) : (
            <Select
              name="sensor"
              label="Sensör"
              value={sensorId}
              onChange={(e) => setSensorId(e.target.value)}
            >
              {sensors.map((sensor) => (
                <option key={sensor.id} value={sensor.id}>
                  {sensor.label} ({sensor.unit || "birimsiz"})
                </option>
              ))}
            </Select>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              name="comparison"
              label="Koşul"
              value={comparison}
              onChange={(e) => setComparison(e.target.value as AlertComparison)}
            >
              <option value="below">Altına düşerse</option>
              <option value="above">Üzerine çıkarsa</option>
            </Select>
            <Input
              name="threshold"
              label="Eşik değeri"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
        </>
      ) : (
        <Input
          name="offline"
          label="Kaç dakika sessizlikten sonra?"
          inputMode="numeric"
          value={offlineMinutes}
          onChange={(e) => setOfflineMinutes(e.target.value)}
        />
      )}

      <Input
        name="cooldown"
        label="Tekrar bekleme süresi (dk)"
        inputMode="numeric"
        value={cooldown}
        onChange={(e) => setCooldown(e.target.value)}
        hint="Aynı uyarının sürekli tekrarlanmasını engeller"
      />

      <Button
        variant="primary"
        fullWidth
        disabled={!canSubmit}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        Kuralı Oluştur
      </Button>
    </div>
  );
}
