/** Sayı ve tarih biçimlendirme yardımcıları (tümü Türkçe yerel ayarla). */

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

/** "3 dk önce", "2 sa önce" gibi göreli zaman. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "az önce";
  if (seconds < 60) return `${seconds} sn önce`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gün önce`;

  return formatDate(date);
}

/** Milimetreyi okunur birime çevirir: 1250 → "1,25 m" */
export function formatMillimeters(mm: number): string {
  if (Math.abs(mm) >= 1000) {
    return `${(mm / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} m`;
  }
  return `${Math.round(mm)} mm`;
}

/** Saniye cinsinden çalışma süresini "3g 4sa 12dk" biçimine çevirir. */
export function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}g`);
  if (hours) parts.push(`${hours}sa`);
  if (!days) parts.push(`${minutes}dk`);
  return parts.join(" ");
}

/** Milisaniyeyi "1 dk 30 sn" biçiminde yazar. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds} sn`;
  return seconds ? `${minutes} dk ${seconds} sn` : `${minutes} dk`;
}

/** WiFi sinyal gücünü (dBm) yüzdeye çevirir. */
export function wifiPercent(dbm: number | undefined): number | null {
  if (dbm === undefined) return null;
  // -90 dBm → %0, -30 dBm → %100
  return Math.max(0, Math.min(100, Math.round(((dbm + 90) / 60) * 100)));
}
