/**
 * Kurulum durumu şeridi — "ne eksik" sorusunun tek yerden cevabı.
 *
 * Neden var
 * ---------
 * Sahada kaybedilen zamanın çoğu "bozuk" ile "kurulmamış"ı ayırt edememekten
 * çıktı: Sistem Sağlığı boştu (ajan o veriyi göndermiyordu), kamera "Kapalı"
 * diyordu (akış hiç kurulmamıştı), sulama hiçbir şey yapmıyordu (pin tanımı
 * kullanılmıyordu). Hiçbirinde panel ne olduğunu söylemedi.
 *
 * Burası her maddeyi tek satırda gösteriyor ve eksik olanı tek tıkla ilgili
 * sayfaya bağlıyor. Tanılama sayfası bu bilgiyi zaten hesaplıyordu ama kimse
 * oraya bakmıyor — bilgi, bakılan yerde durmalı.
 *
 * Her şey tamamsa şerit **kendini gizliyor**: sürekli "her şey yolunda"
 * göstermek, ekranda yer kaplayan ama okunmayan bir kutu üretirdi.
 */

import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/primitives";
import { readMachineConfig } from "@/lib/machine";
import { useBot } from "@/store/useBot";
import { cn } from "@/lib/cn";
import type { Device, Peripheral } from "@/lib/types";

interface Madde {
  ad: string;
  tamam: boolean;
  aciklama: string;
  yol: string;
}

export function KurulumDurumu({
  device,
  peripherals,
}: {
  device: Device | undefined;
  peripherals: Peripheral[] | undefined;
}) {
  // Robotun bağlı olduğunun kanıtı durum ağacının gelmesi. `connected`
  // bayrağı tarayıcı-sunucu bağlantısını anlatıyor, robotu değil.
  const status = useBot((s) => s.status);
  const config = readMachineConfig(device?.settings);

  if (!device) return null;

  const eksenler = config.axes;
  const kalibreEdilmis = (["x", "y", "z"] as const).some(
    (eksen) => eksenler[eksen].cpm !== null,
  );

  const alan = config.planting_area;
  const alanGirilmis =
    alan.x_min_mm !== null ||
    alan.x_max_mm !== null ||
    alan.y_min_mm !== null ||
    alan.y_max_mm !== null;

  const maddeler: Madde[] = [
    {
      ad: "Köprü ajanı",
      tamam: status !== null,
      aciklama: "Raspberry Pi bağlı değil; robot komut alamaz.",
      yol: "/setup",
    },
    {
      ad: "Kalibrasyon",
      tamam: kalibreEdilmis,
      aciklama: "Eksen ölçeği girilmedi — mesafeler gerçeği yansıtmayabilir.",
      yol: "/settings",
    },
    {
      ad: "Ekim alanı",
      tamam: alanGirilmis,
      aciklama: "Ofset girilmedi; yatağın tamamı ekilebilir sayılıyor.",
      yol: "/designer",
    },
    {
      ad: "Su pompası",
      tamam: (peripherals ?? []).some((p) => p.role === "water_pump"),
      aciklama: "Tanımlı değil; sulama komutu çalışmaz.",
      yol: "/settings",
    },
    {
      // Yuva tanımlı değilse ekim ucu almadan tohumluğa gider ve vakum boşa
      // çalışır. Komut hata vermediği için ancak sahada fark edilir.
      ad: "Tohum ucu yuvası",
      tamam: config.tool_zone.slots.some((y) => y.role === "seeder"),
      aciklama: "Yuva atanmadı; ekim, vakum ucunu almadan başlar.",
      yol: "/settings",
    },
    {
      ad: "Güvenli geçiş",
      tamam: config.travel_guard && device.safe_height_mm !== 0,
      aciklama: "Yükseklik girilmedi; uç yatay harekette kaldırılmıyor.",
      yol: "/settings",
    },
  ];

  const eksikler = maddeler.filter((m) => !m.tamam);

  // Her şey tamamsa yer kaplamasın
  if (eksikler.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="size-4 text-warning" />
        <h2 className="font-display text-sm font-semibold text-content">
          Kurulum tamamlanmadı
        </h2>
        <span className="text-xs text-subtle">
          {maddeler.length - eksikler.length}/{maddeler.length} hazır
        </span>
      </div>

      <ul className="space-y-1.5">
        {eksikler.map((madde) => (
          <li key={madde.ad}>
            <Link
              to={madde.yol}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5",
                "transition-soft hover:border-warning/40 hover:bg-surface-3",
              )}
            >
              <span className="size-2 shrink-0 rounded-full bg-warning" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-medium text-content">
                  {madde.ad}
                </span>
                <span className="text-xs text-subtle">{madde.aciklama}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul>

      {maddeler.length - eksikler.length > 0 && (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="size-3.5" />
          Hazır: {maddeler.filter((m) => m.tamam).map((m) => m.ad).join(" · ")}
        </p>
      )}
    </Card>
  );
}
