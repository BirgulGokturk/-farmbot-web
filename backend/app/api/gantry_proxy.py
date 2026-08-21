"""Gantry Studio'yu panelin içinden sunan ters vekil.

Neden gerekli
-------------
Ortağın hareket arayüzü Pi'de ayrı bir sunucuda (`localhost:8091`) çalışıyor ve
sahada kusursuz çalışan kısım orası. Onu panelin içinde bir sekmede göstermek
istiyoruz, ama iki engel var:

  * Tarayıcılar **HTTPS** bir sayfanın içine **HTTP** bir sayfa gömülmesini
    engelliyor. Uyarı vermiyor, doğrudan reddediyor ("karışık içerik").
  * Pi'nin yerel adresi (`192.168.1.x:8091`) zaten yalnızca aynı ağdan
    erişilebilir; dışarıdan panele giren biri oraya ulaşamaz.

İkisi de aynı şekilde çözülüyor: istekler bizim sunucumuzdan geçiyor. Tarayıcı
açısından her şey **tek kaynaktan** geliyor — aynı adres, aynı sertifika.

Yol ayrımı
----------
Bizim API'miz kesinlikle `/api/v1` altında. Gantry Studio ise `/api/status`,
`/api/cmd`, `/api/calib`, `/api/live`, `/api/monitor` ve `/photos/...`
kullanıyor. Bu yüzden kural basit ve geleceğe dayanıklı:

    `/api/` altındaki **`v1` olmayan** her şey + `/photos/` → Gantry Studio

Böylece ortağın eklediği, bizim bilmediğimiz bir uç da kendiliğinden çalışıyor.

Neden çerez
-----------
Vekil, makineyi süren komutları taşıyor; tünelle dışarı açıldığında adresi
bilen herkes robotu oynatabilirdi. Ama gömülü sayfa **bizim** sayfamız değil:
kendi isteklerini atarken `Authorization` başlığımızı eklemiyor ve ona kod
enjekte etmek istemiyoruz (dokunulmaması gereken kısım orası).

Tarayıcı, aynı kaynağa giden isteklere çerezleri kendiliğinden ekliyor. Bu
yüzden panel sekmeyi açmadan önce kısa ömürlü, imzalı bir çerez alıyor ve
vekil onu arıyor. Sayfanın kodunda tek satır değişiklik gerekmiyor.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser
from app.core.config import settings
from app.core.security import GANTRY_TOKEN_MINUTES, create_token, decode_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Gantry Studio"])

COOKIE_NAME = "farmbot_gantry"
COOKIE_MINUTES = GANTRY_TOKEN_MINUTES

# Yanıttan çıkarılması gerekenler. Bunlar bağlantıya özgü; olduğu gibi
# aktarılırsa tarayıcı gövdeyi yanlış çözer (özellikle `content-length`
# yeniden akıttığımız için artık doğru değil).
_ATLANAN_BASLIKLAR = {
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
    # Gömmeyi engelleyebilecek başlıklar. Gantry Studio bugün göndermiyor ama
    # ileride eklenirse sekme sessizce boş kalırdı.
    "x-frame-options",
    "content-security-policy",
}


def gantry_enabled() -> bool:
    return bool(settings.GANTRY_PROXY_URL)


def _hedef() -> str:
    if not settings.GANTRY_PROXY_URL:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Gantry Studio vekili yapılandırılmamış. "
                "GANTRY_PROXY_URL ayarını verin (ör. http://localhost:8091)."
            ),
        )
    return settings.GANTRY_PROXY_URL.rstrip("/")


def _yetkili_mi(cerez: str | None) -> bool:
    if not cerez:
        return False
    # `decode_token` yanlış türde ya da süresi dolmuş token'da None dönüyor;
    # erişim token'ı bu çerezin yerine geçemiyor.
    return decode_token(cerez, "gantry") is not None


def issue_cookie(response: Response, user_id: str) -> None:
    """Sekme açılmadan önce çağrılıyor; imzalı çerezi yerleştirir."""
    token = create_token(user_id, "gantry")
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MINUTES * 60,
        httponly=True,      # JavaScript okuyamasın
        samesite="lax",
        # Yerel ağda HTTP de kullanılabiliyor; `secure` zorlarsak çerez hiç
        # yerleşmez ve sekme çalışmaz. Tünel arkasında zaten HTTPS.
        secure=False,
        path="/",
    )


async def _vekil(request: Request, yol: str) -> Response:
    """İsteği Gantry Studio'ya iletir ve yanıtı olduğu gibi geri verir."""
    hedef = f"{_hedef()}/{yol.lstrip('/')}"

    # Host başlığını taşımıyoruz: hedef sunucu kendi adını görmeli.
    basliklar = {
        ad: deger
        for ad, deger in request.headers.items()
        if ad.lower() not in {"host", "cookie", "authorization", "content-length"}
    }

    istemci = httpx.AsyncClient(
        # Okuma zaman aşımı yok: `/api/live` bir olay akışı ve dakikalarca
        # açık kalıyor. Sınır koyarsak canlı veri düzenli olarak kopardı.
        timeout=httpx.Timeout(connect=5.0, read=None, write=15.0, pool=5.0),
    )
    istek = istemci.build_request(
        request.method,
        hedef,
        params=request.query_params,
        headers=basliklar,
        content=await request.body(),
    )

    try:
        yanit = await istemci.send(istek, stream=True)
    except httpx.HTTPError as hata:
        await istemci.aclose()
        logger.warning("Gantry Studio'ya ulaşılamadı (%s): %s", hedef, hata)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Gantry Studio yanıt vermiyor. Pi'de çalıştığını ve "
                f"{_hedef()} adresinden erişilebildiğini kontrol edin."
            ),
        ) from hata

    async def akit():
        # Akış hâlinde aktarıyoruz: olay akışını tamponlasaydık canlı veri
        # anlık olmaktan çıkardı, büyük fotoğraflar da belleği şişirirdi.
        try:
            async for parca in yanit.aiter_raw():
                yield parca
        finally:
            await yanit.aclose()
            await istemci.aclose()

    return StreamingResponse(
        akit(),
        status_code=yanit.status_code,
        headers={
            ad: deger
            for ad, deger in yanit.headers.items()
            if ad.lower() not in _ATLANAN_BASLIKLAR
        },
        media_type=yanit.headers.get("content-type"),
    )


def _guard(cerez: str | None) -> None:
    if not _yetkili_mi(cerez):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Gantry oturumu yok. Panelden Hareket sekmesini açın.",
        )


@router.api_route(
    "/gantry-ui/{yol:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def gantry_ui(
    request: Request,
    yol: str = "",
    farmbot_gantry: str | None = Cookie(default=None),
) -> Response:
    """Gantry Studio'nun kendi sayfası — sekmenin içine bu yükleniyor."""
    _guard(farmbot_gantry)
    return await _vekil(request, yol)


@router.api_route(
    "/photos/{yol:path}",
    methods=["GET", "HEAD"],
    include_in_schema=False,
)
async def gantry_photos(
    request: Request,
    yol: str,
    farmbot_gantry: str | None = Cookie(default=None),
) -> Response:
    """Kamera kareleri — sayfa bunları `/photos/...` diye çağırıyor."""
    _guard(farmbot_gantry)
    return await _vekil(request, f"photos/{yol}")


@router.api_route(
    "/api/{yol:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def gantry_api(
    request: Request,
    yol: str,
    farmbot_gantry: str | None = Cookie(default=None),
) -> Response:
    """Gantry Studio'nun API'si.

    Bizim uçlarımız `/api/v1` altında; buraya yalnızca ona ait olmayanlar
    düşüyor. Yine de açıkça kontrol ediyoruz: bir gün yönlendirme sırası
    değişirse istek sessizce yanlış sunucuya gitmesin.
    """
    if yol.split("/", 1)[0] == "v1":
        raise HTTPException(status_code=404, detail="Bulunamadı")
    _guard(farmbot_gantry)
    return await _vekil(request, f"api/{yol}")


# --------------------------------------------------------------------------- #
# Oturum — panel sekmeyi açmadan önce çağırıyor
# --------------------------------------------------------------------------- #

session_router = APIRouter(prefix="/gantry", tags=["Gantry Studio"])


@session_router.get("/status")
async def gantry_status(user: CurrentUser) -> dict[str, Any]:
    """Sekme gösterilsin mi? Panel menüyü buna bakarak çiziyor."""
    return {
        "enabled": gantry_enabled(),
        "url": "/gantry-ui/" if gantry_enabled() else None,
    }


@session_router.post("/session")
async def gantry_session(response: Response, user: CurrentUser) -> dict[str, Any]:
    """Gömülü sayfanın kullanacağı çerezi verir.

    Kullanıcı oturumu şart: bu çerez makineyi süren komutlara kapı açıyor.
    """
    if not gantry_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gantry Studio vekili bu kurulumda yapılandırılmamış.",
        )
    issue_cookie(response, str(user.id))
    return {"url": "/gantry-ui/", "expires_minutes": COOKIE_MINUTES}
