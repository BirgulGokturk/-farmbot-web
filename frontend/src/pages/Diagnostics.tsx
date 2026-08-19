/**
 * Tanılama — sinyal zinciri ve ham PLC verisi.
 *
 * Neden bu sayfa var: bir hareket komutu panelden PLC'ye ulaşana kadar dört
 * ayrı halkadan geçiyor (tarayıcı → bulut → köprü ajanı → Gantry Studio → PLC).
 * Zincir koptuğunda panelde görünen tek şey "hareket etmiyor" oluyordu; hangi
 * halkanın koptuğunu anlamak için her seferinde Pi'ye SSH ile bağlanıp günlük
 * okumak gerekiyordu.
 *
 * Burada her halka ayrı ayrı görünüyor. Ayrıca PLC'nin **ham register
 * değerleri** de tabloda: milimetreye çevrilmiş konum sorunu gizleyebiliyor,
 * ama enable biti, jog bitleri ve ham sayaç yalan söylemiyor.
 *
 * Register adresleri PLC_BRIEF.md ve plc/plc_registers.json ile aynı; X'in
 * düzensiz yerleşimi bilerek vurgulanıyor (aşağıdaki nota bakın).
 */

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Cpu,
  Gauge,
  Monitor,
  Server,
  X,
} from "lucide-react";

import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import { useBot } from "@/store/useBot";

/**
 * PLC register haritası — kaynak: plc/plc_registers.json (ortağın belgesi).
 *
 * X'in yerleşimi Y ve Z'den **farklı**: Y 1030, Z 1050 tabanlı ve düzenli
 * (+0 jogf, +1 jogb, +2 go, +3 home, +4 target, +6 vel, +8 accel, +10 decel,
 * +12 pos). X ise 1020 tabanlı ama yalnızca jog/go/home/target orada; `pos`
 * base+6'da (Y/Z'de orası vel), vel/accel/decel ise 1000–1007'ye alınmış.
 *
 * Bu tabloyu burada göstermemizin sebebi: aynı adım aralığını X'e uygulayan
 * bir uygulama, X'in decel değerini 1030/1031'e — yani **Y'nin jog bitlerine**
 * — yazıyor ve Y sürekli hareket etmeye başlıyor. Belgede "canlı hata" olarak
 * geçen sorun bu.
 */
const REGISTERS = {
  x: { jogf: 1020, jogb: 1021, go: 1022, home: 1023, target: 1024, pos: 1026, vel: 1006, accel: 1000, decel: 1002 },
  y: { jogf: 1030, jogb: 1031, go: 1032, home: 1033, target: 1034, pos: 1042, vel: 1036, accel: 1038, decel: 1040 },
  z: { jogf: 1050, jogb: 1051, go: 1052, home: 1053, target: 1054, pos: 1062, vel: 1056, accel: 1058, decel: 1060 },
} as const;

const ENABLE_REGISTER = 1010;
const AXES = ["x", "y", "z"] as const;
type AxisName = (typeof AXES)[number];

interface RawAxis {
  en?: number | null;
  jf?: number | null;
  jb?: number | null;
  vel?: number | null;
  accel?: number | null;
  decel?: number | null;
  pos?: number | null;
  err?: string | null;
  off?: boolean;
}

export default function Diagnostics() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const connected = useBot((s) => s.connected);
  const status = useBot((s) => s.status);

  const { data: agentStatus } = useQuery({
    queryKey: ["agent-status", deviceId],
    queryFn: () => api.agent.status(deviceId!),
    enabled: Boolean(deviceId),
    refetchInterval: 4000,
  });

  const diagnostics = (status?.diagnostics ?? {}) as {
    axes_raw?: RawAxis[];
    gantry_latency_ms?: number | null;
    presence?: boolean | null;
  };

  const rawAxes = diagnostics.axes_raw ?? [];
  const latency = diagnostics.gantry_latency_ms ?? null;
  const plcOk = rawAxes.length > 0 && rawAxes.some((a) => a && !a.off && a.err == null);

  /**
   * Zincirin halkaları. Her biri kendi kanıtına dayanıyor — "muhtemelen
   * çalışıyor" diye bir durum yok: ya veri geliyor ya gelmiyor.
   */
  const chain = [
    {
      label: "Tarayıcı → Bulut",
      Icon: Monitor,
      ok: connected,
      detail: connected ? "WebSocket açık" : "Bağlantı yok",
    },
    {
      label: "Bulut → Köprü ajanı",
      Icon: Server,
      ok: Boolean(agentStatus?.connected),
      detail: agentStatus?.connected
        ? "Komut kanalı açık"
        : agentStatus?.has_token
          ? "Token var, ajan bağlı değil"
          : "Token üretilmemiş",
    },
    {
      label: "Ajan → Gantry Studio",
      Icon: Cpu,
      ok: latency !== null,
      detail: latency !== null ? `${latency.toFixed(0)} ms gidiş-dönüş` : "Yanıt yok",
    },
    {
      label: "Gantry Studio → PLC",
      Icon: Gauge,
      ok: plcOk,
      detail: plcOk ? "Register okunuyor" : "Eksen verisi gelmiyor",
    },
  ];

  const brokenAt = chain.findIndex((link) => !link.ok);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tanılama"
        description="Sinyal zinciri ve ham PLC verisi"
        icon={<Activity className="size-5" />}
        actions={
          <Badge tone={brokenAt === -1 ? "success" : "danger"} dot pulse={brokenAt === -1}>
            {brokenAt === -1 ? "Zincir sağlam" : `${chain[brokenAt].label} kopuk`}
          </Badge>
        }
      />

      {/* Zincir */}
      <Card>
        <CardHeader
          title="Sinyal zinciri"
          subtitle="Komut panelden PLC'ye dört halkadan geçiyor"
          icon={<Activity className="size-4" />}
        />
        <div className="grid gap-3 lg:grid-cols-4">
          {chain.map((link, index) => (
            <div key={link.label} className="relative">
              <div
                className={cn(
                  "h-full rounded-xl border px-3.5 py-3",
                  link.ok
                    ? "border-success/30 bg-success/5"
                    : index === brokenAt
                      ? "border-danger/40 bg-danger/10"
                      : "border-line bg-surface-2",
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <link.Icon
                    className={cn(
                      "size-4",
                      link.ok ? "text-success" : index === brokenAt ? "text-danger" : "text-subtle",
                    )}
                  />
                  <span className="text-xs font-semibold text-content">{link.label}</span>
                  {link.ok ? (
                    <Check className="ml-auto size-4 text-success" />
                  ) : (
                    <X className="ml-auto size-4 text-danger" />
                  )}
                </div>
                <p className="text-xs text-muted">{link.detail}</p>
              </div>

              {/* Halkalar arası ok — son halkadan sonra yok */}
              {index < chain.length - 1 && (
                <ArrowRight className="absolute -right-2.5 top-1/2 hidden size-4 -translate-y-1/2 text-subtle lg:block" />
              )}
            </div>
          ))}
        </div>

        {brokenAt !== -1 && (
          <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            İlk kopan halka: <strong>{chain[brokenAt].label}</strong> — {chain[brokenAt].detail}.
            Sonraki halkaların durumu bu düzelene kadar anlamlı değil.
          </p>
        )}
      </Card>

      {/* Ham register tablosu */}
      <Card>
        <CardHeader
          title="PLC register değerleri"
          subtitle={`Modbus-TCP · ${device?.name ?? "cihaz"} · genel etkinleştirme ${ENABLE_REGISTER}`}
          icon={<Gauge className="size-4" />}
          action={
            latency !== null ? (
              <Badge tone={latency < 50 ? "success" : latency < 300 ? "warning" : "danger"}>
                {latency.toFixed(0)} ms
              </Badge>
            ) : undefined
          }
        />

        {rawAxes.length === 0 ? (
          <p className="py-8 text-center text-sm text-subtle">
            Henüz register verisi gelmedi. Köprü ajanı bağlanıp Gantry Studio'dan durum
            okuduğunda tablo dolacak.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-subtle">
                  <th className="px-2 py-2 font-medium">Eksen</th>
                  <th className="px-2 py-2 font-medium">Etkin</th>
                  <th className="px-2 py-2 font-medium">Jog +/−</th>
                  <th className="px-2 py-2 font-medium">Ham konum</th>
                  <th className="px-2 py-2 font-medium">Hız</th>
                  <th className="px-2 py-2 font-medium">İvme</th>
                  <th className="px-2 py-2 font-medium">Yavaşlama</th>
                  <th className="px-2 py-2 font-medium">Adresler</th>
                </tr>
              </thead>
              <tbody>
                {AXES.map((axis, index) => {
                  const raw = rawAxes[index] ?? {};
                  const map = REGISTERS[axis as AxisName];
                  const jogging = Boolean(raw.jf) || Boolean(raw.jb);

                  return (
                    <tr key={axis} className="border-b border-line/60 last:border-0">
                      <td className="px-2 py-2.5 font-semibold text-content">
                        {axis.toUpperCase()}
                        {raw.err && (
                          <span className="ml-2 text-xs font-normal text-danger">{raw.err}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <Bit on={Boolean(raw.en)} />
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <Bit on={Boolean(raw.jf)} label="+" />
                          <Bit on={Boolean(raw.jb)} label="−" />
                          {jogging && <span className="text-xs text-brand">hareket</span>}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-brand">
                        {fmt(raw.pos)}
                      </td>
                      <td className="px-2 py-2.5 font-mono text-muted">{fmt(raw.vel)}</td>
                      <td className="px-2 py-2.5 font-mono text-muted">{fmt(raw.accel)}</td>
                      <td className="px-2 py-2.5 font-mono text-muted">{fmt(raw.decel)}</td>
                      <td className="px-2 py-2.5 font-mono text-[0.7rem] text-subtle">
                        pos {map.pos} · vel {map.vel} · acc {map.accel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* X'in düzensiz yerleşimi — belgede "canlı hata" olarak geçiyor */}
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3">
          <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-warning">
            <AlertTriangle className="size-3.5" />
            X ekseni düzenli adım aralığını kullanmıyor
          </p>
          <p className="text-xs text-muted">
            Y 1030, Z 1050 tabanlı ve düzenli. X ise 1020 tabanlı ama yalnızca
            jog/go/home/target orada: <span className="font-mono">pos</span> base+6'da (Y/Z'de
            orası <span className="font-mono">vel</span>), vel/accel/decel ise 1000–1007'ye
            alınmış. Aynı adım aralığını X'e uygulayan bir uygulama, X'in yavaşlama değerini
            1030/1031'e — yani <strong>Y'nin jog bitlerine</strong> — yazar ve Y durmadan
            hareket etmeye başlar.
          </p>
          <p className="mt-1.5 text-xs text-subtle">
            Panel register'a doğrudan yazmıyor; komutlar Gantry Studio'nun HTTP arayüzünden
            geçiyor. Bu tablo yalnızca okuma amaçlı.
          </p>
        </div>
      </Card>
    </div>
  );
}

/** Tek bitlik gösterge — 0/1 yerine göz kararıyla okunsun. */
function Bit({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-6 place-items-center rounded-md text-[0.7rem] font-semibold",
        on ? "bg-success/20 text-success" : "bg-surface-2 text-subtle",
      )}
      title={on ? "1" : "0"}
    >
      {label ?? (on ? "1" : "0")}
    </span>
  );
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
