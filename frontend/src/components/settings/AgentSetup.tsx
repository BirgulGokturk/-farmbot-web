/**
 * Köprü ajanı kurulumu — Raspberry Pi'nin buluta bağlanması için token yönetimi.
 *
 * Token yalnızca üretildiği anda düz metin gösterilir; sunucuda hash'i saklanır.
 * Bu yüzden kopyalama bu ekranda öne çıkarılıyor ve kaybedilirse yenisinin
 * üretilmesi gerektiği açıkça yazılıyor.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Cpu, KeyRound, Radio, Trash2, TriangleAlert } from "lucide-react";

import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useDeviceId } from "@/hooks/useDevice";

export function AgentSetup() {
  const deviceId = useDeviceId();
  const queryClient = useQueryClient();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["agent-status", deviceId],
    queryFn: () => api.agent.status(deviceId!),
    enabled: Boolean(deviceId),
    // Pi bağlandığı anda görünsün
    refetchInterval: 10_000,
  });

  const createToken = useMutation({
    mutationFn: () => api.agent.createToken(deviceId!),
    onSuccess: (result) => {
      setFreshToken(result.token);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ["agent-status", deviceId] });
      toast.success("Token üretildi", "Kopyalayın — bir daha gösterilmeyecek.");
    },
    onError: (error) => toast.error("Token üretilemedi", (error as Error).message),
  });

  const revokeToken = useMutation({
    mutationFn: () => api.agent.revokeToken(deviceId!),
    onSuccess: () => {
      setFreshToken(null);
      void queryClient.invalidateQueries({ queryKey: ["agent-status", deviceId] });
      toast.success("Token iptal edildi", "Bağlı ajan varsa bağlantısı kesildi.");
    },
    onError: (error) => toast.error("İptal edilemedi", (error as Error).message),
  });

  async function copyToken() {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Kopyalanamadı", "Metni elle seçip kopyalayın.");
    }
  }

  const connected = status?.connected ?? false;

  return (
    <Card>
      <CardHeader
        title="Köprü Ajanı"
        subtitle="Raspberry Pi + Arduino bağlantısı"
        icon={<Cpu className="size-4" />}
        action={
          <Badge tone={connected ? "success" : "neutral"} dot pulse={connected}>
            {connected ? "Bağlı" : "Bağlı değil"}
          </Badge>
        }
      />

      <div className="space-y-4">
        {/* Durum özeti */}
        <dl className="space-y-2 rounded-xl bg-surface-2 p-3.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Token</dt>
            <dd className="text-content">
              {status?.has_token ? "Tanımlı" : "Yok"}
              {status?.token_created_at && (
                <span className="ml-1.5 text-subtle">
                  ({formatRelative(status.token_created_at)})
                </span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Son veri</dt>
            <dd className="text-content">{formatRelative(status?.last_seen_at)}</dd>
          </div>
        </dl>

        {/* Yeni üretilen token — yalnızca bir kez */}
        {freshToken && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warning">
              <TriangleAlert className="size-3.5" />
              Bu token yalnızca şimdi gösteriliyor
            </p>
            <code className="block break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-content">
              {freshToken}
            </code>
            <Button
              size="sm"
              className="mt-2"
              fullWidth
              icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={copyToken}
            >
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<KeyRound className="size-4" />}
            loading={createToken.isPending}
            onClick={() => createToken.mutate()}
          >
            {status?.has_token ? "Yenile" : "Token Üret"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="size-4" />}
            disabled={!status?.has_token}
            loading={revokeToken.isPending}
            onClick={() => revokeToken.mutate()}
          >
            İptal Et
          </Button>
        </div>

        {/* Pi'de çalıştırılacak komut */}
        <div className="rounded-xl bg-surface-2 p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Radio className="size-3.5" />
            Raspberry Pi'de çalıştırın
          </p>
          <pre className="overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-muted">
{`cd ~/-farmbot-web/agent
.venv/bin/python farmbot_agent.py \\
  --port /dev/ttyUSB0 \\
  --token ${freshToken ?? "<token>"}`}
          </pre>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            Ayrıntılı kurulum, bağlantı şeması ve sorun giderme için depodaki{" "}
            <code className="font-mono">agent/README.md</code> dosyasına bakın.
          </p>
        </div>

        <p
          className={cn(
            "rounded-lg px-3 py-2 text-xs leading-relaxed",
            connected ? "bg-success/10 text-success" : "bg-surface-2 text-subtle",
          )}
        >
          {connected
            ? "Ajan bağlı — sensör verileri canlı olarak akıyor ve simülatör durduruldu."
            : "Ajan bağlanmadığı sürece panel simülatörle çalışır; grafiklerdeki veriler sanaldır."}
        </p>
      </div>
    </Card>
  );
}
