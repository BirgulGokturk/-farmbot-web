/**
 * Ondalık sayı alanı.
 *
 * Çözdüğü hata: kutular her tuşta `Number(e.target.value)` çağırıyordu ve
 * ondalık yazmak imkânsızdı.
 *
 *   * Türkçe klavyede ondalık ayırıcı **virgül**. `Number("70,5")` → `NaN`,
 *     yedek değer 0 olduğu için virgüle basar basmaz alan sıfırlanıyordu.
 *   * Nokta kullanılsa bile ara durum kayboluyordu: "70." yazınca `Number`
 *     onu 70 yapıyor, alan "70" olarak yeniden çiziliyor ve nokta siliniyordu.
 *     Yani "70.5" yazmanın hiçbir yolu yoktu.
 *   * Kutuyu tamamen boşaltmak da değeri 0'a düşürüyordu.
 *
 * Çözüm: yazarken **taslak metin** olduğu gibi korunuyor. Sayıya çevrilebilir
 * bir hâle geldiğinde değer yukarı bildiriliyor; ara durumlarda ("", "-",
 * "70.") hiçbir şey bildirilmiyor, böylece yazmaya devam edilebiliyor.
 *
 * Odak çıkınca taslak normalleştiriliyor: virgül noktaya çevriliyor. Sebebi
 * tutarlılık — hareket önizlemesi koordinatları virgülle ayırıyor
 * (`10,70.5,150`), ondalık da virgül olsaydı "10,70,5,150" okunamazdı.
 */

import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/primitives";

/** Sayıyı gereksiz sıfır olmadan yazar: 70.5 → "70.5", 150 → "150". */
function bicimle(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

/** Yazılanı sayıya çevirir; çevrilemiyorsa `null`. */
function coz(raw: string): number | null {
  const metin = raw.replace(",", ".").trim();
  // Ara durumlar: kullanıcı hâlâ yazıyor, karışma
  if (metin === "" || metin === "-" || metin === "." || metin === "-.") return null;
  if (metin.endsWith(".")) return null;
  const parsed = Number(metin);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface NumberFieldProps {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  /** Alan boşaltıldığında kabul edilecek en küçük değer. */
  min?: number;
  placeholder?: string;
  name?: string;
  /**
   * Değer ne zaman bildirilsin?
   *
   * `change` (varsayılan): her geçerli tuşta. Yerel durumu güncelleyen
   * formlar için doğru — önizleme yazarken güncellenir.
   *
   * `blur`: yalnızca odak çıkınca ya da Enter'a basınca. Her tuşta sunucuya
   * yazan alanlar için şart: "1200" yazarken sırayla 1, 12, 120 kaydedilir ve
   * robot bir anlığına bahçenin başka bir yerine ait koordinat görürdü.
   */
  commitOn?: "change" | "blur";
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  placeholder,
  name,
  commitOn = "change",
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => bicimle(value));
  // Son bildirdiğimiz değer. Dışarıdan gelen değişikliği kendi bildirimimizden
  // ayırmak için: aksi hâlde her tuşta taslağı kendi bildirdiğimiz sayıyla
  // ezer ve yine ondalık yazamazdık.
  const sonBildirilen = useRef(value);

  useEffect(() => {
    if (value !== sonBildirilen.current) {
      sonBildirilen.current = value;
      setDraft(bicimle(value));
    }
  }, [value]);

  return (
    <Input
      name={name ?? label ?? "sayi"}
      label={label}
      inputMode="decimal"
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (commitOn !== "change") return;
        const parsed = coz(e.target.value);
        if (parsed === null) return;
        if (min !== undefined && parsed < min) return;
        sonBildirilen.current = parsed;
        onChange(parsed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        // Escape: yazılanı at, sunucudaki değere dön
        if (e.key === "Escape") setDraft(bicimle(sonBildirilen.current));
      }}
      onBlur={() => {
        const parsed = coz(draft);
        const gecerli =
          parsed !== null && (min === undefined || parsed >= min) ? parsed : null;

        // Geçersiz ya da boş bırakıldıysa son geçerli değere dön; sessizce
        // 0 yazmak, kullanıcının farkında olmadan ayarı bozması demekti.
        if (gecerli === null) {
          setDraft(bicimle(sonBildirilen.current));
          return;
        }
        if (commitOn === "blur" && gecerli !== sonBildirilen.current) {
          sonBildirilen.current = gecerli;
          onChange(gecerli);
        }
        setDraft(bicimle(gecerli));
      }}
    />
  );
}
