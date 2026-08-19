#!/usr/bin/env bash
#
# Yazi tiplerini Turkce alt kumesine indirger ve frontend/public/fonts altina yazar.
#
# Neden gerekli:
#   Fontlar eskiden Google Fonts'tan geliyordu. Google her aileyi unicode
#   araligina gore boluyor; Turkce'deki "g s I" karakterleri `latin-ext`
#   aralaginda ve Inter'in latin-ext dosyasi tek basina 83 KiB -- kendi latin
#   dosyasinin (47 KiB) neredeyse iki kati. Yani agirlik basina 130 KiB.
#
#   Burada `latin` araligi + Turkce'de eksik kalan bes karakter (G g I S s;
#   "i" zaten latin'de var) aliniyor ve font degisken (variable) birakiliyor,
#   boylece tek dosya butun agirliklari karsiliyor.
#
# Ne zaman calistirilir:
#   - Yeni bir yazi tipi ailesi eklenince
#   - Arayuzde alt kumede olmayan bir karakter gerekince (UNICODES'a ekle)
#   - Kaynak fontlarin yeni surumune gecilince
#
# DIKKAT: cikti dosyalarinin adinda icerik ozeti yok ve render.yaml bunlari
# bir yil `immutable` olarak onbellege aldiriyor. Icerik degisirse dosya adini
# da degistirin, yoksa tarayicilar eskisini kullanmaya devam eder.
#
# Gereksinim: python3 + fonttools[woff]  (asagida gecici bir venv'e kurulur)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/frontend/public/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Google'in `latin` unicode-range'i, arti Turkce'de eksik kalanlar ve
# arayuzde kullanilan birkac sembol.
UNICODES='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD,U+011E-011F,U+0130,U+015E-015F,U+2022,U+2713,U+25CF'

# index.css `font-feature-settings: "cv02","cv03","cv04","cv11"` kullaniyor,
# primitives.tsx ise tabular-nums (tnum). pyftsubset varsayilan olarak bunlari
# atar; acikca korunmalari gerekiyor.
FEATURES='--layout-features+=cv02,cv03,cv04,cv11,tnum,ss01,ss02,zero,case'

SRC="https://raw.githubusercontent.com/google/fonts/main/ofl"

echo "==> fonttools kuruluyor (gecici venv)"
python3 -m venv "$WORK/venv"
PY="$WORK/venv/bin/python"
[ -x "$PY" ] || PY="$WORK/venv/Scripts/python.exe"   # Windows
"$PY" -m pip install -q --disable-pip-version-check "fonttools[woff]"

# $1 kaynak URL  $2 cikti dosyasi  $3 eksen limitleri
build() {
  local url="$1" out="$2" axes="$3"
  echo "==> $out"
  curl -sL -o "$WORK/src.ttf" "$url"
  "$PY" -m fontTools.varLib.instancer "$WORK/src.ttf" $axes -o "$WORK/inst.ttf" --quiet
  "$PY" -m fontTools.subset "$WORK/inst.ttf" \
      --unicodes="$UNICODES" $FEATURES \
      --flavor=woff2 --output-file="$OUT/$out" \
      --desubroutinize --name-IDs='' --notdef-outline
}

mkdir -p "$OUT"

# Eksen araliklari arayuzde fiilen kullanilan agirliklara gore secildi:
#   Inter  : govde 400, font-medium 500, font-semibold 600, font-bold 700
#   Sora   : h1-h4 varsayilani 600, EmergencyStop 700 (500 kullanilmiyor)
#   Mono   : 400 ve 500
build "$SRC/inter/Inter%5Bopsz,wght%5D.ttf"            inter-tr.woff2          "opsz=14 wght=400:700"
build "$SRC/sora/Sora%5Bwght%5D.ttf"                   sora-tr.woff2           "wght=500:700"
build "$SRC/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" jetbrains-mono-tr.woff2 "wght=400:500"

echo
printf "%-26s %s\n" "DOSYA" "BOYUT"
for f in inter-tr.woff2 sora-tr.woff2 jetbrains-mono-tr.woff2; do
  printf "%-26s %7.1f KiB\n" "$f" "$(stat -c%s "$OUT/$f" | awk '{print $1/1024}')"
done

echo
echo "Bitti. @font-face tanimlari frontend/src/index.css icinde."
