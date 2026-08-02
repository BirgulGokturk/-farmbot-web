/**
 * Uygulamanın bölüm haritası.
 * Sol menü, mobil alt çubuk ve sayfa başlıkları hep buradan beslenir —
 * yeni bir bölüm eklemek için tek yer burası.
 */

import {
  Boxes,
  CalendarClock,
  Camera,
  Gamepad2,
  Gauge,
  Leaf,
  LineChart,
  ListTree,
  Map,
  ScrollText,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Mobil alt çubukta gösterilecek mi (yer sınırlı, sadece en sık kullanılanlar) */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "İzleme",
    items: [
      {
        path: "/",
        label: "Kontrol Merkezi",
        icon: Gauge,
        description: "Robotun anlık durumu ve hızlı işlemler",
        primary: true,
      },
      {
        path: "/viewer",
        label: "3D Görünüm",
        icon: Boxes,
        description: "Robotun gerçek zamanlı dijital ikizi",
      },
      {
        path: "/camera",
        label: "Kamera",
        icon: Camera,
        description: "Canlı akış ve konum etiketli fotoğraflar",
        primary: true,
      },
      {
        path: "/sensors",
        label: "Sensörler",
        icon: ListTree,
        description: "Toprak nemi, sıcaklık ve ışık ölçümleri",
      },
    ],
  },
  {
    label: "Kontrol",
    items: [
      {
        path: "/control",
        label: "Manuel Kontrol",
        icon: Gamepad2,
        description: "Robotu elle sür, çevre birimlerini yönet",
        primary: true,
      },
      {
        path: "/sequences",
        label: "Diziler",
        icon: Workflow,
        description: "Yeniden kullanılabilir komut dizileri",
      },
    ],
  },
  {
    label: "Tarla",
    items: [
      {
        path: "/designer",
        label: "Tarla Tasarımcısı",
        icon: Map,
        description: "Bitkileri sürükle-bırak ile yerleştir",
        primary: true,
      },
      {
        path: "/plants",
        label: "Bitki Kütüphanesi",
        icon: Leaf,
        description: "Tür kataloğu ve yetiştirme bilgileri",
      },
      {
        path: "/curves",
        label: "Büyüme Eğrileri",
        icon: LineChart,
        description: "Yaşa göre su, yayılma ve boy değerleri",
      },
    ],
  },
  {
    label: "Planlama",
    items: [
      {
        path: "/schedule",
        label: "Sulama & Takvim",
        icon: CalendarClock,
        description: "Zamanlanmış görevler ve sulama programı",
        primary: true,
      },
    ],
  },
  {
    label: "Sistem",
    items: [
      {
        path: "/logs",
        label: "Kayıtlar",
        icon: ScrollText,
        description: "Robottan gelen canlı olay akışı",
      },
      {
        path: "/settings",
        label: "Ayarlar",
        icon: Settings,
        description: "Cihaz, donanım ve hesap ayarları",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const PRIMARY_NAV_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter((item) => item.primary);

export function findNavItem(pathname: string): NavItem | undefined {
  // En uzun eşleşen yol kazansın (/designer, / ile de eşleşmesin)
  return [...ALL_NAV_ITEMS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => (item.path === "/" ? pathname === "/" : pathname.startsWith(item.path)));
}
