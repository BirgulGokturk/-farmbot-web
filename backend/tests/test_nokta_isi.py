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


class TestUcHazirla:
    """Uç değiştirme Gantry Studio'ya devredildi.

    Diziyi kendimiz kuruyorduk ve aynı geometriyi iki yerde hesaplamak sahada
    kırıldı: yaklaşma noktası eksen sınırının dışına düştü
    ("Y target -1.8 mm outside limits") ve komut hiç başlamadan reddedildi.
    Artık tek adım üretip Gantry Studio'ya "şu ucu tak" diyoruz.
    """

    HEDEF = {"name": "tool2", "label": "Toprak Probu", "x": 40, "y": 18, "z": 150}
    ACIK = {"enabled": True}

    def test_tek_adim_uretiliyor(self) -> None:
        adimlar = commands.uc_hazirla(self.HEDEF, None, self.ACIK)
        assert adimlar == [{"kind": "tool_change", "args": {"name": "tool2"}}]

    def test_koordinat_uretilmiyor(self) -> None:
        """Geometri Gantry Studio'da; buradan hareket komutu çıkmamalı."""
        adimlar = commands.uc_hazirla(self.HEDEF, None, {**self.ACIK, "approach_offset": -20})
        assert all(a["kind"] == "tool_change" for a in adimlar)

    def test_dogru_uc_takiliysa_bos(self) -> None:
        """Her işte ucu bırakıp yeniden almak zaman kaybı ve gereksiz aşınma."""
        assert commands.uc_hazirla(self.HEDEF, {"name": "tool2"}, self.ACIK) == []

    def test_baska_uc_takiliysa_degistiriliyor(self) -> None:
        """Bırakma adımını da Gantry Studio üstleniyor — tek çağrı yetiyor."""
        adimlar = commands.uc_hazirla(self.HEDEF, {"name": "tool1"}, self.ACIK)
        assert adimlar == [{"kind": "tool_change", "args": {"name": "tool2"}}]

    def test_gorev_atanmamissa_bos(self) -> None:
        """Tek uçlu makinede uç değiştirme diye bir şey yok."""
        assert commands.uc_hazirla(None, {"name": "tool1"}, self.ACIK) == []

    def test_kapaliyken_hicbir_sey_uretilmiyor(self) -> None:
        """Varsayılan kapalı ve kapalıyken tek bir hareket bile çıkmamalı.

        Kilitleme servosu ve varlık sensörü tanımlı olmadan uç alma çalışmıyor
        ama Gantry Studio "başarılı" diyor: kafa yuvalarda dolaşıp hiçbir şey
        takmıyor, sonra da "elimde tool1 var" sanıp onu bırakmaya gidiyor.
        Kapalıyken hiç hareket üretmemek, işe yaramayan hareket üretmekten iyi.
        """
        assert commands.uc_hazirla(self.HEDEF, None, {}) == []
        assert commands.uc_hazirla(self.HEDEF, None, {"enabled": False}) == []
        assert commands.uc_hazirla(self.HEDEF, {"name": "tool1"}, {}) == []
