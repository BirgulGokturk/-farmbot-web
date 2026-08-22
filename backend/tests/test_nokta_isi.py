"""Noktada iş — komut dizisi ve uç nokta bağlantısı.

Buradaki testler iki şeyi kilitliyor:

  1. Prob dizisinin **sırası**. "Bat, bekle, oku, çek" adımlarından biri
     kayarsa belirti sessiz olur: robot çalışır, bir sayı da döner — ama sayı
     havanın nemidir. Yanlış veriyi doğru veriden ayırmak, hatayı sonradan
     fark etmekten çok daha zor.
  2. Uç noktanın uygulamaya bağlı kalması. Rota kaydı unutulursa panel 404
     alır ve sebebi "sunucu hatası" gibi görünür.
"""

from __future__ import annotations

from app.services import commands


class TestToprakOlc:
    def kur(self, **degisiklik):
        varsayilan = dict(
            x=100.0,
            y=200.0,
            soil_z=0.0,
            safe_z=300.0,
            depth_mm=30.0,
            pin=1,
            mode=1,
            label="toprak_nemi",
            settle_ms=2000,
            speed=50,
        )
        varsayilan.update(degisiklik)
        return commands.toprak_olc(**varsayilan)

    def test_sira_bat_bekle_oku_cek(self) -> None:
        adimlar = self.kur()
        assert [a["kind"] for a in adimlar] == [
            "move_absolute",  # güvenli yükseklikte yatayda git
            "move_absolute",  # toprağa bat
            "wait",
            "read_pin",
            "move_absolute",  # probu çek
        ]

    def test_derinlik_yuzeyden_asagi_olculuyor(self) -> None:
        """`depth_mm` çıkarılıyor: yüzey 0 ve derinlik 30 ise hedef -30."""
        adimlar = self.kur(soil_z=0.0, depth_mm=30.0)
        z = adimlar[1]["args"]["location"]["args"]["z"]
        assert z == -30.0

    def test_yuzey_sifir_degilse_de_dogru(self) -> None:
        adimlar = self.kur(soil_z=-15.0, depth_mm=30.0)
        assert adimlar[1]["args"]["location"]["args"]["z"] == -45.0

    def test_okumadan_once_bekleniyor(self) -> None:
        """Beklemeden okumak ıslak toprağı kuru gösteriyordu."""
        adimlar = self.kur(settle_ms=2500)
        assert adimlar[2]["args"]["milliseconds"] == 2500

    def test_sonunda_guvenli_yukseklige_cekiliyor(self) -> None:
        """Prob toprakta kalırsa sonraki yatay hareket onu sürükler."""
        adimlar = self.kur(safe_z=300.0)
        assert adimlar[-1]["args"]["location"]["args"]["z"] == 300.0

    def test_dogru_pin_okunuyor(self) -> None:
        adimlar = self.kur(pin=3, mode=1, label="toprak_nemi")
        assert adimlar[3]["args"]["pin_number"] == 3
        assert adimlar[3]["args"]["label"] == "toprak_nemi"


class TestUcNokta:
    def test_spot_rotasi_kayitli(self) -> None:
        from app.main import app

        yollar = {
            (r.path, tuple(sorted(r.methods)))
            for r in app.routes
            if hasattr(r, "methods")
        }
        assert ("/api/v1/devices/{device_id}/control/spot", ("POST",)) in yollar


class TestKanalliSensor:
    """Pinsiz (kanallı) sensör — sahadaki toprak nemi sensörü böyle çalışıyor.

    Arduino A1'i kendi döngüsünde okuyup `soil_moisture` kanalını yayınlıyor;
    panel ona "şu pini oku" diyemiyor. Uç nokta bunu bir hata sayıyordu ve
    doğru kurulmuş bir donanımı arızalı gibi gösteriyordu.
    """

    def test_pinsizken_okuma_adimi_uretilmiyor(self) -> None:
        adimlar = commands.toprak_olc(
            x=0, y=0, soil_z=0, safe_z=100, depth_mm=30, pin=None
        )
        assert [a["kind"] for a in adimlar] == [
            "move_absolute",
            "move_absolute",
            "wait",
            "move_absolute",
        ]

    def test_pinsizken_de_batip_cikiyor(self) -> None:
        """Ölçüm kendiliğinden geliyor ama robot doğru yerde durmalı."""
        adimlar = commands.toprak_olc(
            x=0, y=0, soil_z=0, safe_z=100, depth_mm=30, pin=None
        )
        assert adimlar[1]["args"]["location"]["args"]["z"] == -30
        assert adimlar[-1]["args"]["location"]["args"]["z"] == 100
