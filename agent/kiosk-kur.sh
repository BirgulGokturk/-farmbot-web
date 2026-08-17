#!/usr/bin/env bash
#
# FarmBot panelini Raspberry Pi ekranında uygulama gibi çalıştırır.
#
# Ne yapar:
#   1. Masaüstüne ve uygulama menüsüne "FarmBot" simgesi ekler
#   2. Pi açıldığında paneli tam ekran (kiosk) başlatır
#   3. Ekran koruyucuyu ve uyku kipini kapatır — bahçe paneli sürekli açık kalmalı
#
# Kullanım:
#   chmod +x kiosk-kur.sh
#   ./kiosk-kur.sh
#
# Kaldırmak için:
#   ./kiosk-kur.sh --kaldir

set -euo pipefail

PANEL_URL="${FARMBOT_PANEL_URL:-https://farmbot-hmi.onrender.com}"
UYGULAMA_ADI="FarmBot"
BASLATICI="$HOME/.local/share/applications/farmbot.desktop"
OTOBASLAT="$HOME/.config/autostart/farmbot-kiosk.desktop"
BASLAT_BETIGI="$HOME/.local/bin/farmbot-kiosk.sh"
SIMGE="$HOME/.local/share/icons/farmbot.png"

# Chromium paket adı dağıtıma göre değişiyor
tarayici_bul() {
  for aday in chromium-browser chromium google-chrome; do
    if command -v "$aday" >/dev/null 2>&1; then
      echo "$aday"
      return 0
    fi
  done
  return 1
}

kaldir() {
  rm -f "$BASLATICI" "$OTOBASLAT" "$BASLAT_BETIGI" "$SIMGE" "$HOME/Desktop/farmbot.desktop"
  echo "Kaldırıldı. Değişikliğin görünmesi için oturumu yeniden başlatın."
  exit 0
}

[[ "${1:-}" == "--kaldir" ]] && kaldir

TARAYICI="$(tarayici_bul || true)"
if [[ -z "$TARAYICI" ]]; then
  echo "HATA: Chromium bulunamadı. Şununla kurabilirsiniz:"
  echo "  sudo apt update && sudo apt install -y chromium-browser"
  exit 1
fi

echo "Tarayıcı: $TARAYICI"
echo "Panel adresi: $PANEL_URL"

mkdir -p "$(dirname "$BASLATICI")" "$(dirname "$OTOBASLAT")" \
         "$(dirname "$BASLAT_BETIGI")" "$(dirname "$SIMGE")"

# --- Simge ---
# Depodaki simgeyi kullan; yoksa panelden indirmeyi dene
if [[ -f "$(dirname "$0")/../frontend/public/icon-192.png" ]]; then
  cp "$(dirname "$0")/../frontend/public/icon-192.png" "$SIMGE"
else
  curl -fsSL "$PANEL_URL/icon-192.png" -o "$SIMGE" 2>/dev/null || true
fi

# --- Kiosk başlatma betiği ---
cat > "$BASLAT_BETIGI" <<BETIK
#!/usr/bin/env bash
# FarmBot panelini tam ekran açar. kiosk-kur.sh tarafından üretildi.

# Ekran koruyucu ve uyku kipini kapat — bahçe paneli sürekli açık kalmalı.
# (Wayland'da xset bulunmayabilir, hata vermesin diye bastırıyoruz.)
xset s off      2>/dev/null || true
xset -dpms      2>/dev/null || true
xset s noblank  2>/dev/null || true

# Önceki oturumdan kalan "düzgün kapatılmadı" uyarısını temizle;
# elektrik kesintisinden sonra ekranda bu diyalog kalmasın.
PROFIL="\$HOME/.config/chromium/Default/Preferences"
if [[ -f "\$PROFIL" ]]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "\$PROFIL" 2>/dev/null || true
fi

exec $TARAYICI \\
  --app="$PANEL_URL" \\
  --start-fullscreen \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --check-for-update-interval=604800 \\
  --password-store=basic
BETIK
chmod +x "$BASLAT_BETIGI"

# --- Uygulama menüsü / masaüstü simgesi ---
cat > "$BASLATICI" <<MASAUSTU
[Desktop Entry]
Type=Application
Name=$UYGULAMA_ADI
Comment=Akıllı tarım robotu yönetim paneli
Exec=$BASLAT_BETIGI
Icon=$SIMGE
Terminal=false
Categories=Utility;
StartupNotify=true
MASAUSTU
chmod +x "$BASLATICI"

# Masaüstünde de görünsün (klasör adı dile göre değişebiliyor)
for masaustu in "$HOME/Desktop" "$HOME/Masaüstü"; do
  if [[ -d "$masaustu" ]]; then
    cp "$BASLATICI" "$masaustu/farmbot.desktop"
    chmod +x "$masaustu/farmbot.desktop"
  fi
done

# --- Açılışta otomatik başlat ---
cat > "$OTOBASLAT" <<OTO
[Desktop Entry]
Type=Application
Name=$UYGULAMA_ADI Kiosk
Exec=$BASLAT_BETIGI
Icon=$SIMGE
Terminal=false
X-GNOME-Autostart-enabled=true
OTO

echo
echo "Kurulum tamam."
echo
echo "  Şimdi denemek için : $BASLAT_BETIGI"
echo "  Masaüstü simgesi   : $UYGULAMA_ADI"
echo "  Açılışta otomatik  : evet"
echo
echo "Tam ekrandan çıkmak için F11, kapatmak için Alt+F4."
echo "Kaldırmak için: $0 --kaldir"
