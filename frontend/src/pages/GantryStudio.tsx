/**
 * Gantry Studio sekmesi.
 *
 * Ortağın hareket arayüzü Pi'de ayrı bir sunucuda çalışıyor ve sahada
 * kusursuz çalışan kısım orası. Burada onu **olduğu gibi** gösteriyoruz —
 * tek satırını yeniden yazmıyoruz.
 *
 * Neden doğrudan `http://<pi>:8091` gömülmüyor: tarayıcılar HTTPS bir sayfanın
 * içine HTTP bir sayfa gömülmesini engelliyor ve Pi'nin yerel adresi zaten
 * dışarıdan erişilebilir değil. Bu yüzden sayfa kendi sunucumuz üzerinden
 * geliyor (`/gantry-ui/`) — tarayıcı açısından her şey tek kaynaktan.
 *
 * Gömülü sayfa bizim `Authorization` başlığımızı taşımadığı için, çerçeveyi
 * yüklemeden önce kısa ömürlü bir çerez alıyoruz; vekil onu arıyor.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Gamepad2, RefreshCw } from "lucide-react";

import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api";

export default function GantryStudio() {
  const [hazir, setHazir] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const cerceve = useRef<HTMLIFrameElement>(null);

  const oturum = useMutation({
    mutationFn: () => api.gantry.session(),
    onSuccess: () => {
      setHata(null);
      setHazir(true);
    },
    onError: (error) => {
      setHazir(false);
      setHata((error as Error).message);
    },
  });

  // Sayfa açılınca çerezi al; çerçeve ancak ondan sonra yüklenmeli, yoksa
  // ilk istek 401 alır ve kullanıcı boş bir kutu görür.
  const baslat = oturum.mutate;
  useEffect(() => {
    baslat();
  }, [baslat]);

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Hareket Kontrolü"
        description="Gantry Studio — eksen sürme, ev arama ve kalibrasyon"
        icon={<Gamepad2 className="size-5" />}
        actions={
          <div className="flex gap-2">
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={oturum.isPending}
              onClick={() => {
                // Çerezi tazeleyip çerçeveyi yeniden yükle
                setHazir(false);
                oturum.mutate();
              }}
            >
              Yenile
            </Button>
            <Button
              icon={<ExternalLink className="size-4" />}
              onClick={() => window.open("/gantry-ui/", "_blank", "noopener")}
            >
              Yeni sekmede aç
            </Button>
          </div>
        }
      />

      {hata && (
        <Card>
          <p className="text-sm font-medium text-danger">
            Gantry Studio açılamadı
          </p>
          <p className="mt-1 text-sm text-muted">{hata}</p>
          <div className="mt-3 space-y-1.5 rounded-xl bg-surface-2 p-3.5 text-xs leading-relaxed text-subtle">
            <p>Olası sebepler:</p>
            <p>
              • Panel <strong>bulutta</strong> çalışıyor. Gantry Studio Pi'nin
              içinde olduğu için buluttan erişilemiyor; bu sekme yalnızca panel
              Pi'den sunulduğunda çalışır.
            </p>
            <p>
              • <code className="font-mono text-content">GANTRY_PROXY_URL</code>{" "}
              ayarı verilmemiş.
            </p>
            <p>• Gantry Studio Pi'de çalışmıyor.</p>
          </div>
        </Card>
      )}

      {hazir && (
        <Card className="flex-1 overflow-hidden p-0">
          {/*
            `sandbox` kullanmıyoruz: Gantry Studio kendi JavaScript'iyle
            çalışıyor ve kısıtlarsak butonları işlevsiz kalır. Sayfa zaten
            kendi sunucumuzdan geliyor, üçüncü taraf değil.
          */}
          <iframe
            ref={cerceve}
            src="/gantry-ui/"
            title="Gantry Studio"
            className="h-full min-h-[70vh] w-full border-0"
          />
        </Card>
      )}

      {!hazir && !hata && (
        <Card>
          <p className="py-8 text-center text-sm text-subtle">
            Gantry Studio yükleniyor…
          </p>
        </Card>
      )}
    </div>
  );
}
