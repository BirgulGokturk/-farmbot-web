import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Camera, Trash2, ImageOff, RefreshCw, Video, VideoOff } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useActiveDevice, useDeviceId } from "@/hooks/useDevice";
import type { CapturedImage } from "@/lib/types";

export default function CameraPage() {
  const deviceId = useDeviceId();
  const { data: device } = useActiveDevice();
  const queryClient = useQueryClient();

  const [streaming, setStreaming] = useState(true);
  /** Akışı yeniden başlatmak için URL'ye eklenen sayaç (tarayıcı önbelleğini atlar). */
  const [streamKey, setStreamKey] = useState(0);
  const [capturing, setCapturing] = useState(false);

  const { data: images } = useQuery({
    queryKey: ["images", deviceId],
    queryFn: () => api.images.list(deviceId!),
    enabled: Boolean(deviceId),
  });

  const streamUrl = device?.camera_stream_url;

  const sil = useMutation({
    mutationFn: (imageId: string) => api.images.remove(deviceId!, imageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["images", deviceId] });
      toast.success("Fotoğraf silindi");
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  const hepsiniSil = useMutation({
    mutationFn: () => api.images.clear(deviceId!),
    onSuccess: (sonuc) => {
      void queryClient.invalidateQueries({ queryKey: ["images", deviceId] });
      toast.success(sonuc.detail);
    },
    onError: (error) => toast.error("Silinemedi", (error as Error).message),
  });

  async function capture() {
    if (!deviceId) return;
    setCapturing(true);
    try {
      await api.control.takePhoto(deviceId);
      toast.success("Fotoğraf çekiliyor", "Yüklendiğinde galeride görünecek.");
      // Robotun çekip yüklemesi birkaç saniye sürer
      window.setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ["images", deviceId] }),
        4000,
      );
    } catch (error) {
      toast.error("Fotoğraf çekilemedi", (error as Error).message);
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kamera"
        description="Canlı görüntü ve konum etiketli fotoğraflar"
        icon={<Camera className="size-5" />}
        actions={
          <>
            <Button
              size="sm"
              icon={streaming ? <VideoOff className="size-4" /> : <Video className="size-4" />}
              onClick={() => setStreaming(!streaming)}
              disabled={!streamUrl}
            >
              {streaming ? "Akışı Durdur" : "Akışı Başlat"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Camera className="size-4" />}
              loading={capturing}
              onClick={capture}
            >
              Fotoğraf Çek
            </Button>
          </>
        }
      />

      <Card flush>
        <div className="p-5 pb-3">
          <CardHeader
            title="Canlı Akış"
            subtitle={
              streamUrl ??
              "Kurulmadı — fotoğraf çekmek için gerekmiyor"
            }
            icon={<Video className="size-4" />}
            action={
              <div className="flex items-center gap-2">
                <Badge tone={streaming && streamUrl ? "success" : "neutral"} dot pulse={streaming && !!streamUrl}>
                  {streaming && streamUrl ? "Yayında" : "Kapalı"}
                </Badge>
                <Button
                  size="sm"
                  icon={<RefreshCw className="size-3.5" />}
                  onClick={() => setStreamKey((k) => k + 1)}
                  disabled={!streamUrl || !streaming}
                >
                  Yenile
                </Button>
              </div>
            }
            className="mb-0"
          />
        </div>

        {/*
          Canlı akış ile fotoğraf çekmek **ayrı** işler. Akış ayrı bir video
          sunucusu istiyor; fotoğraf ise ajan üzerinden çalışıyor ve hiçbir ek
          kurulum gerektirmiyor. Bunu yazmazsak "Kapalı" rozeti kameranın hiç
          bağlı olmadığı izlenimini veriyor.
        */}
        {!streamUrl && (
          <p className="mx-5 mb-3 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-subtle">
            Canlı akış kurulmadı. <strong className="text-content">Fotoğraf Çek</strong>{" "}
            bundan bağımsız çalışır: robot kareyi çekip konumuyla birlikte
            yükler ve aşağıdaki galeride görünür.
          </p>
        )}

        <div className="mx-5 mb-5 aspect-video overflow-hidden rounded-xl border border-line bg-black">
          {streamUrl && streaming ? (
            // Raspberry Pi tarafındaki MJPEG akışı doğrudan <img> ile gösterilebilir
            <img
              key={streamKey}
              src={`${streamUrl}${streamUrl.includes("?") ? "&" : "?"}t=${streamKey}`}
              alt="Robot kamerası canlı görüntüsü"
              className="size-full object-contain"
              onError={() => toast.error("Akışa bağlanılamadı", "Kamera adresini Ayarlar'dan kontrol edin.")}
            />
          ) : (
            <div className="grid size-full place-items-center text-center">
              <div className="text-subtle">
                <VideoOff className="mx-auto mb-2 size-8" />
                <p className="text-sm">
                  {streamUrl ? "Akış duraklatıldı" : "Ayarlar'dan kamera adresi tanımlayın"}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Fotoğraf Galerisi"
          subtitle={`${images?.total ?? 0} kayıt`}
          icon={<Camera className="size-4" />}
          action={
            images?.items.length ? (
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-3.5" />}
                loading={hepsiniSil.isPending}
                onClick={() => {
                  // Geri alınamayan bir işlem; onay istemek burada abartı değil
                  if (window.confirm(`${images.total} fotoğrafın hepsi silinsin mi?`)) {
                    hepsiniSil.mutate();
                  }
                }}
              >
                Tümünü sil
              </Button>
            ) : undefined
          }
        />
        {images?.items.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {images.items.map((image) => (
              <figure
                key={image.id}
                className="group relative overflow-hidden rounded-xl border border-line bg-surface-2"
              >
                {/* Fareyle üstüne gelince beliriyor: her karenin üstünde
                    duran bir çöp kutusu galeriyi kalabalıklaştırırdı.
                    Dokunmatik cihazlarda `focus-within` ile de açılıyor. */}
                <button
                  type="button"
                  aria-label="Bu fotoğrafı sil"
                  disabled={sil.isPending}
                  className="absolute right-1.5 top-1.5 z-10 rounded-lg bg-surface/85 p-1.5 text-danger opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-danger/15 focus:opacity-100"
                  onClick={() => sil.mutate(image.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>

                <GalleryImage
                  deviceId={deviceId!}
                  image={image}
                  alt={`Çekim: ${formatDateTime(image.captured_at)}`}
                />
                <figcaption className="px-2.5 py-2 text-[0.7rem] leading-tight text-subtle">
                  <span className="block text-content">{formatDateTime(image.captured_at)}</span>
                  {image.x !== null && image.y !== null && (
                    <span className="font-mono">
                      X {Math.round(image.x)} · Y {Math.round(image.y)}
                    </span>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ImageOff className="size-6" />}
            title="Henüz fotoğraf yok"
            description="Robot fotoğraf çektiğinde burada konum etiketiyle listelenecek."
          />
        )}
      </Card>
    </div>
  );
}

/**
 * Galeri karesi.
 *
 * Kare veritabanında saklandığı ve uç nokta oturum istediği için doğrudan
 * `<img src>` ile gösterilemiyor — tarayıcı `<img>` isteğine `Authorization`
 * başlığı eklemez. Kareyi kimlikli olarak indirip `blob:` adresi üretiyoruz.
 *
 * Üretilen adres bileşen kalktığında serbest bırakılıyor: 48 karelik bir
 * galeride bunu atlamak sayfa açık kaldıkça biriken bir bellek sızıntısı olurdu.
 */
function GalleryImage({
  deviceId,
  image,
  alt,
}: {
  deviceId: string;
  image: CapturedImage;
  alt: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Dış bir adres verilmişse (eski kayıtlar) doğrudan kullanılabilir
  const external = /^https?:\/\//i.test(image.url) ? image.url : null;

  useEffect(() => {
    if (external) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    api.images
      .file(deviceId, image.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deviceId, image.id, external]);

  const finalSrc = external ?? src;

  if (failed) {
    return (
      <div className="grid aspect-square w-full place-items-center bg-surface text-xs text-subtle">
        Görüntü alınamadı
      </div>
    );
  }

  if (!finalSrc) {
    return <div className="aspect-square w-full animate-pulse bg-surface" />;
  }

  return (
    <img
      src={finalSrc}
      alt={alt}
      loading="lazy"
      className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
    />
  );
}
