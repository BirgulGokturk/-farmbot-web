/**
 * Servis çalışanı kaydı ve güncelleme yönetimi.
 *
 * Uygulama Raspberry Pi'nin ekranında günlerce açık kalabilir. Yeni bir sürüm
 * yayınlandığında kullanıcı bunu fark etmeyeceği için, güncelleme hazır olunca
 * bir bildirim gösterip yenilemeyi teklif ediyoruz.
 */

import { toast } from "@/components/ui/toast";

// Geliştirme sunucusunda servis çalışanı istemiyoruz: önbellek, HMR ile
// çakışıp değişikliklerin görünmemesine yol açıyor.
const ENABLED = import.meta.env.PROD && "serviceWorker" in navigator;

export function registerServiceWorker(): void {
  if (!ENABLED) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Yeni sürüm indirildiğinde kullanıcıyı bilgilendir
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            const isUpdate = installing.state === "installed" && navigator.serviceWorker.controller;
            if (isUpdate) {
              toast.info(
                "Yeni sürüm hazır",
                "Güncellemeyi uygulamak için sayfayı yenileyin.",
              );
            }
          });
        });

        // Uzun süre açık kalan ekranlarda güncellemeyi saatte bir yokla
        window.setInterval(() => void registration.update(), 60 * 60 * 1000);
      })
      .catch((error) => {
        // Servis çalışanı olmadan da uygulama çalışır; sessizce geç
        console.warn("Servis çalışanı kaydedilemedi:", error);
      });
  });
}

/**
 * Tarayıcının "uygulama olarak yükle" teklifini yakalar.
 * Chromium bu olayı yalnızca kurulabilirlik koşulları sağlanınca tetikler.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function captureInstallPrompt(onAvailable: (available: boolean) => void): () => void {
  if (!("serviceWorker" in navigator)) return () => {};

  function onBeforeInstall(event: Event) {
    // Varsayılan mini çubuğu engelle; kurulumu kendi düğmemizden sunacağız
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    onAvailable(true);
  }

  function onInstalled() {
    deferredPrompt = null;
    onAvailable(false);
    toast.success("Uygulama kuruldu", "Artık masaüstünden açabilirsiniz.");
  }

  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);

  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/** Kurulum penceresini açar. Teklif yoksa false döner. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === "accepted";
}

/** Uygulama kendi penceresinde mi çalışıyor (kurulmuş mu)? */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari standart olmayan bu alanı kullanıyor
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
