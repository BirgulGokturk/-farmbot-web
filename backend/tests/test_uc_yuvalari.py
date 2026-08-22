"""Uç yuvası eşitleme testleri.

Bu testler somut bir kayma riskinden doğdu: istasyon koordinatları iki yerde
duruyor — ortağın Gantry Studio'sunda (gerçek kaynak) ve bizim
`device.settings` kopyamızda. Kopya eskidiğinde kafa yuvayı sıyırır ve hiçbir
yerde hata görünmez. Buradaki testler tazelemenin doğru tarafı ezdiğini
doğruluyor: koordinat Gantry Studio'dan, görev ve okunur ad bizden.
"""

from __future__ import annotations

import pytest

from app.services import gantry_studio, machine_config


class TestTazeleYuvalar:
    def test_koordinat_canlidan_geliyor(self) -> None:
        yuvalar = [{"name": "tool1", "label": "Tohum Ucu", "x": 0, "y": 0, "z": 0, "role": "seeder"}]
        canli = {"tool1": {"x": 120.0, "y": 40.0, "z": 150.0}}

        (sonuc,) = gantry_studio.tazele_yuvalar(yuvalar, canli)

        assert (sonuc["x"], sonuc["y"], sonuc["z"]) == (120.0, 40.0, 150.0)

    def test_gorev_ve_etiket_korunuyor(self) -> None:
        """Gantry Studio'da bu iki alanın karşılığı yok; ezilirlerse kaybolurlar."""
        yuvalar = [{"name": "tool2", "label": "Toprak Probu", "x": 0, "y": 0, "z": 0, "role": "soil_probe"}]
        canli = {"tool2": {"x": 1.0, "y": 2.0, "z": 3.0}}

        (sonuc,) = gantry_studio.tazele_yuvalar(yuvalar, canli)

        assert sonuc["role"] == "soil_probe"
        assert sonuc["label"] == "Toprak Probu"

    def test_canlida_olmayan_yuva_olduu_gibi_kaliyor(self) -> None:
        """Elle tanımlanmış istasyon, ortağın listesinde yok diye silinmemeli."""
        yuvalar = [{"name": "elle", "label": "Elle", "x": 5, "y": 6, "z": 7, "role": "none"}]

        (sonuc,) = gantry_studio.tazele_yuvalar(yuvalar, {"tool1": {"x": 0, "y": 0, "z": 0}})

        assert (sonuc["x"], sonuc["y"], sonuc["z"]) == (5, 6, 7)

    def test_gantry_ulasilamazsa_kopya_gecerli(self) -> None:
        """Ortağın sunucusu kapalı diye ekim tamamen durmamalı."""
        yuvalar = [{"name": "tool1", "label": "Tohum", "x": 9, "y": 9, "z": 9, "role": "seeder"}]

        assert gantry_studio.tazele_yuvalar(yuvalar, {}) == yuvalar


class TestYuvaNormalleştirme:
    def test_etiket_bos_birakilirsa_ada_dusuyor(self) -> None:
        zone = machine_config.normalize_tool_zone(
            {"slots": [{"name": "tool1", "x": 1, "y": 2, "z": 3}]}
        )
        assert zone["slots"][0]["label"] == "tool1"

    def test_bilinmeyen_gorev_none_oluyor(self) -> None:
        """Elle düzenlenmiş bir ayar dosyası komutu çökertmemeli."""
        zone = machine_config.normalize_tool_zone(
            {"slots": [{"name": "tool1", "x": 0, "y": 0, "z": 0, "role": "sulayıcı"}]}
        )
        assert zone["slots"][0]["role"] == "none"

    @pytest.mark.parametrize("gorev", ["seeder", "waterer", "soil_probe"])
    def test_tanimli_gorevler_geciyor(self, gorev: str) -> None:
        zone = machine_config.normalize_tool_zone(
            {"slots": [{"name": "tool1", "x": 0, "y": 0, "z": 0, "role": gorev}]}
        )
        assert zone["slots"][0]["role"] == gorev


class TestGantryOkuma:
    """Gerçek `/api/tools` yanıt biçimine karşı ayrıştırma.

    Gövde, Gantry Studio'nun `gantry_tools.json` yapısıyla birebir aynı:
    istasyonlar `tools` altında ve yalnızca ad + koordinat taşıyor; görev
    alanı orada yok, o bizde.
    """

    @pytest.fixture
    def sunucu(self):
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        govde = json.dumps(
            {
                "tools": [
                    {"name": "tool1", "x": 10, "y": 70.5, "z": 150},
                    {"name": "tool2", "x": 40, "y": 120, "z": 150},
                    {"name": "tool3", "x": 70, "y": 170, "z": 150},
                    {"name": "bozuk", "y": 1},  # koordinatı eksik: atlanmalı
                    "çöp",  # sözlük bile değil
                ],
                "current_tool": "tool1",
                "travel_z": 530.0,
                "safe_z": 500.0,
                "slide_axis": "y",
                "approach": -20.0,
                "lift": 50.0,
            }
        ).encode()

        class Sahte(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(govde)))
                self.end_headers()
                self.wfile.write(govde)

            def log_message(self, *_a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), Sahte)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        yield f"http://127.0.0.1:{srv.server_port}"
        srv.shutdown()

    @pytest.mark.asyncio
    async def test_istasyonlar_okunuyor(self, sunucu, monkeypatch) -> None:
        # Ayarı modülün **kendi** tuttuğu nesne üzerinde değiştiriyoruz.
        # `from app.core.config import settings` ile taze bir referans almak
        # yetmiyor: vekil testleri `app.core.config`'i yeniden yüklüyor ve o
        # noktadan sonra iki ayrı Settings örneği dolaşımda oluyor. Testler tek
        # başına geçip toplu koşuda düşmesinin sebebi buydu.
        monkeypatch.setattr(gantry_studio.settings, "GANTRY_PROXY_URL", sunucu)
        veri = await gantry_studio.uc_istasyonlari(tazele=True)

        assert veri["available"] is True
        assert [y["name"] for y in veri["slots"]] == ["tool1", "tool2", "tool3"]
        assert veri["slots"][0] == {"name": "tool1", "x": 10.0, "y": 70.5, "z": 150.0}
        assert veri["current_tool"] == "tool1"
        assert veri["slide_axis"] == "Y"
        assert veri["travel_z"] == 530.0

    @pytest.mark.asyncio
    async def test_ulasilamayinca_hata_atmiyor(self, monkeypatch) -> None:
        """Ayar sayfası, ortağın sunucusu kapalı diye kullanılamaz olmamalı."""
        # Kapalı bir port: bağlantı anında reddediliyor
        monkeypatch.setattr(gantry_studio.settings, "GANTRY_PROXY_URL", "http://127.0.0.1:1")
        veri = await gantry_studio.uc_istasyonlari(tazele=True)

        assert veri["available"] is False
        assert "ulaşılamadı" in veri["reason"]

    @pytest.mark.asyncio
    async def test_yapilandirilmamissa_sessizce_kapali(self, monkeypatch) -> None:
        monkeypatch.setattr(gantry_studio.settings, "GANTRY_PROXY_URL", None)
        veri = await gantry_studio.uc_istasyonlari(tazele=True)

        assert veri["available"] is False
