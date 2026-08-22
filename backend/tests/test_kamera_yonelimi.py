"""Kamera yönelimi ayarının ayrıştırma testleri.

Bu ayar panelden gelip ajanın çekim komutuna bayrak olarak ekleniyor. İki şeyi
korumak istiyoruz:

  * **Desteklenmeyen açı sessizce 0'a düşmeli.** `rpicam-still --rotation`
    yalnızca 0 ve 180 kabul ediyor; 90 geçerse komut hata ile biter ve
    kullanıcı "fotoğraf çekilemedi" mesajından sebebi anlayamaz.
  * **Bölüm her zaman üretilmeli.** Ajan `payload["camera"]` bekliyor; eski
    cihaz kayıtlarında bu anahtar yok ve eksik kalırsa yönelim hiç gönderilmez.
"""

from __future__ import annotations

import pytest

from app.services.machine_config import normalize, normalize_camera


class TestDondurme:
    @pytest.mark.parametrize(
        ("ham", "beklenen"),
        [
            (180, 180),
            ("180", 180),  # ayarlar JSON'dan metin olarak da gelebiliyor
            (0, 0),
            (None, 0),
            (90, 0),  # desteklenmiyor
            (270, 0),  # desteklenmiyor
            ("saçma", 0),
        ],
    )
    def test_yalnizca_sifir_ve_yuz_seksen(self, ham, beklenen):
        assert normalize_camera({"rotation": ham})["rotation"] == beklenen


class TestAynalama:
    @pytest.mark.parametrize("alan", ["hflip", "vflip"])
    def test_varsayilan_kapali(self, alan):
        assert normalize_camera({})[alan] is False

    @pytest.mark.parametrize("alan", ["hflip", "vflip"])
    @pytest.mark.parametrize("ham", [True, 1, "evet"])
    def test_dogru_degerler_acik(self, alan, ham):
        assert normalize_camera({alan: ham})[alan] is True


class TestBolumHepUretiliyor:
    @pytest.mark.parametrize("ham", [None, {}, [], "metin", 42])
    def test_bozuk_girdi_varsayilana_duser(self, ham):
        assert normalize_camera(ham) == {"rotation": 0, "hflip": False, "vflip": False}

    def test_normalize_camera_bolumunu_ekliyor(self):
        """Eski cihaz kayıtlarında `camera` anahtarı yok; yine de gelmeli."""
        assert normalize({})["camera"] == {"rotation": 0, "hflip": False, "vflip": False}

    def test_mevcut_ayarlar_korunuyor(self):
        sonuc = normalize({"camera": {"rotation": 180, "hflip": True}})
        assert sonuc["camera"] == {"rotation": 180, "hflip": True, "vflip": False}
