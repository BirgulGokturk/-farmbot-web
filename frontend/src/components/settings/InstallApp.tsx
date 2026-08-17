/**
 * "Uygulama olarak kur" kartı.
 *
 * Tarayıcı kurulabilirlik koşullarını sağladığında `beforeinstallprompt`
 * olayını tetikler; biz bunu yakalayıp kendi düğmemizden sunuyoruz.
 * Zaten kurulmuşsa (kendi penceresinde çalışıyorsa) kart durumu bildirir.
 */

import { useEffect, useState } from "react";
import { Check, Monitor, Smartphone, TabletSmartphone } from "lucide-react";

import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { captureInstallPrompt, isStandalone, promptInstall } from "@/lib/pwa";

export function InstallApp() {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);
  const [busy, setBusy] = useState(false);

  useEffect(() => captureInstallPrompt(setCanInstall), []);

  async function install() {
    setBusy(true);
    try {
      const accepted = await promptInstall();
      if (accepted) setInstalled(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Uygulama Olarak Kur"
        subtitle="Raspberry Pi ekranı, telefon ve bilgisayar"
        icon={<TabletSmartphone className="size-4" />}
        action={
          installed ? (
            <Badge tone="success" dot>
              Kurulu
            </Badge>
          ) : null
        }
      />

      {installed ? (
        <p className="flex items-start gap-2 rounded-xl bg-success/10 px-3.5 py-3 text-sm text-success">
          <Check className="mt-0.5 size-4 shrink-0" />
          Panel şu anda uygulama penceresinde çalışıyor. Adres çubuğu yok, tam ekran
          kullanılabilir ve internet kısa süre kesilse bile arayüz açık kalır.
        </p>
      ) : (
        <div className="space-y-3.5">
          <p className="text-sm leading-relaxed text-muted">
            Paneli bir uygulama gibi kurabilirsiniz: masaüstüne simge eklenir, kendi
            penceresinde adres çubuğu olmadan açılır ve bağlantı koptuğunda beyaz ekran
            yerine bilgilendirme gösterir.
          </p>

          <Button
            variant="primary"
            fullWidth
            icon={<Monitor className="size-4" />}
            disabled={!canInstall}
            loading={busy}
            onClick={install}
          >
            {canInstall ? "Bu Cihaza Kur" : "Kurulum Şu An Kullanılamıyor"}
          </Button>

          {!canInstall && (
            <div className="space-y-2 rounded-xl bg-surface-2 p-3.5 text-xs leading-relaxed text-subtle">
              <p className="font-medium text-muted">Düğme pasifse elle kurabilirsiniz:</p>
              <p className="flex items-start gap-2">
                <Monitor className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <strong>Chrome / Chromium (Pi, bilgisayar):</strong> adres çubuğunun
                  sağındaki kurulum simgesi, ya da ⋮ menüsü → “Yayınla, kaydet ve paylaş” →
                  “Sayfayı uygulama olarak yükle”
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Smartphone className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <strong>Android:</strong> ⋮ → “Uygulamayı yükle” ·{" "}
                  <strong>iPhone:</strong> Paylaş → “Ana Ekrana Ekle”
                </span>
              </p>
              <p className="pt-1">
                Not: kurulum yalnızca <strong>https</strong> adreste çalışır. Panele
                <code className="mx-1 font-mono">farmbot-hmi.onrender.com</code>
                üzerinden girdiğinizden emin olun.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
