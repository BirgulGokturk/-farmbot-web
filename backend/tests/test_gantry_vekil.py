"""Gantry Studio ters vekili testleri.

Bu vekil makineyi süren komutları taşıyor ve tünelle dışarı açıldığında
adresi bilen herkesin erişimine girer. Bu yüzden korumanın sessizce
bozulmaması kritik; testler dört şeyi kilitliyor:

  1. Çerezsiz istek reddediliyor.
  2. Erişim token'ı bu çerezin yerine geçemiyor (ayrı token türü).
  3. Geçerli çerezle istek Gantry Studio'ya geçiyor ve yanıt bozulmadan dönüyor.
  4. `/api/v1/...` yolları vekile **düşmüyor** — bizim API'miz orada.
"""

from __future__ import annotations

import importlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest


class SahteGantry(BaseHTTPRequestHandler):
    """Gerçek Gantry Studio yerine geçen küçük sunucu."""

    def do_GET(self):  # noqa: N802 (http.server'ın beklediği ad)
        govde = f"GANTRY:{self.path}".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(govde)))
        # Gömmeyi engelleyen bir başlık: vekil bunu temizlemeli
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(govde)

    def do_POST(self):  # noqa: N802
        uzunluk = int(self.headers.get("Content-Length") or 0)
        alinan = self.rfile.read(uzunluk)
        govde = b"ECHO:" + alinan
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(govde)))
        self.end_headers()
        self.wfile.write(govde)

    def log_message(self, *_args):
        pass  # test çıktısını kirletmesin


@pytest.fixture(scope="module")
def gantry_adresi():
    sunucu = HTTPServer(("127.0.0.1", 0), SahteGantry)
    is_parcacigi = threading.Thread(target=sunucu.serve_forever, daemon=True)
    is_parcacigi.start()
    yield f"http://127.0.0.1:{sunucu.server_port}"
    sunucu.shutdown()


@pytest.fixture(scope="module")
def istemci(gantry_adresi, monkeypatch_module):
    """Vekil açıkken taze bir uygulama."""
    from fastapi.testclient import TestClient

    monkeypatch_module.setenv("GANTRY_PROXY_URL", gantry_adresi)

    import app.core.config as config

    importlib.reload(config)
    import app.api.gantry_proxy as vekil

    importlib.reload(vekil)
    import app.main as ana

    importlib.reload(ana)

    with TestClient(ana.app) as c:
        yield c


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch

    mp = MonkeyPatch()
    yield mp
    mp.undo()


def _cerez(tur: str = "gantry") -> str:
    from app.core.security import create_token

    return create_token("11111111-1111-1111-1111-111111111111", tur)


def test_cerezsiz_istek_reddediliyor(istemci):
    yanit = istemci.get("/api/status")
    assert yanit.status_code == 401, yanit.text


def test_erisim_tokeni_cerez_yerine_gecmiyor(istemci):
    # Ayrı token türü olmasaydı, sızan bir çerez tüm API'de kullanılabilirdi
    yanit = istemci.get("/api/status", cookies={"farmbot_gantry": _cerez("access")})
    assert yanit.status_code == 401, yanit.text


def test_gecerli_cerezle_gantry_studioya_geciyor(istemci):
    yanit = istemci.get("/api/status", cookies={"farmbot_gantry": _cerez()})
    assert yanit.status_code == 200, yanit.text
    assert yanit.text == "GANTRY:/api/status", yanit.text


def test_govde_ve_yontem_aktariliyor(istemci):
    yanit = istemci.post(
        "/api/cmd",
        content=b'{"cmd":"movexyz"}',
        cookies={"farmbot_gantry": _cerez()},
    )
    assert yanit.status_code == 200, yanit.text
    assert yanit.text == 'ECHO:{"cmd":"movexyz"}', yanit.text


def test_gomulmeyi_engelleyen_baslik_temizleniyor(istemci):
    # Sahte sunucu X-Frame-Options: DENY gönderiyor; geçse sekme boş kalırdı
    yanit = istemci.get("/api/status", cookies={"farmbot_gantry": _cerez()})
    assert "x-frame-options" not in {k.lower() for k in yanit.headers}


def test_sorgu_dizesi_aktariliyor(istemci):
    yanit = istemci.get("/api/monitor?axis=2", cookies={"farmbot_gantry": _cerez()})
    assert yanit.text == "GANTRY:/api/monitor?axis=2", yanit.text


def test_kendi_apimiz_vekile_dusmuyor(istemci):
    """`/api/v1/...` bizim. Vekile düşseydi panel sessizce çalışmaz olurdu."""
    yanit = istemci.get("/api/v1/devices", cookies={"farmbot_gantry": _cerez()})
    # Kimlik doğrulaması olmadığı için 401 bekliyoruz — ama **bizim** 401'imiz,
    # Gantry Studio'nun yanıtı değil
    assert yanit.status_code in (401, 403), yanit.status_code
    assert "GANTRY:" not in yanit.text


def test_photos_yolu_vekile_gidiyor(istemci):
    yanit = istemci.get("/photos/kare.jpg", cookies={"farmbot_gantry": _cerez()})
    assert yanit.text == "GANTRY:/photos/kare.jpg", yanit.text
