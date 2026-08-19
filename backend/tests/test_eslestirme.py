"""Eşleştirme kodu ve token yenileme testleri.

Bu akış güvenlik açısından hassas: kod kısa ve kullanıcı oturumu istemiyor.
Tek kullanımlık olması, süresinin dolması ve deneme sayısının sınırlı olması
sessizce bozulursa kimse fark etmez — bu yüzden dördü de burada doğrulanıyor.

Ayrıca hoşgörü penceresi test ediliyor: yenileme sırasında ajan yeni token'ı
diskine yazamadan çökerse eskisi bir süre daha kabul edilmeli, aksi hâlde
robot kendini dışarıda bırakır ve Pi'ye fiziksel erişim gerekir.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import agent as ajan
from app.db.base import Base
from app.models import Device, User
from app.schemas.agent import AgentPairRequest


@pytest_asyncio.fixture
async def oturum():
    """Bellekte taze bir veritabanı — testler birbirini etkilemesin."""
    motor = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with motor.begin() as baglanti:
        await baglanti.run_sync(Base.metadata.create_all)

    fabrika = async_sessionmaker(motor, expire_on_commit=False)
    async with fabrika() as s:
        yield s
    await motor.dispose()


@pytest_asyncio.fixture
async def cihaz(oturum):
    kullanici = User(
        id=uuid.uuid4(), email="deneme@ornek.com", hashed_password="x", full_name="Deneme"
    )
    oturum.add(kullanici)
    d = Device(id=uuid.uuid4(), user_id=kullanici.id, name="Test Robot")
    oturum.add(d)
    await oturum.commit()
    return d


async def _kod_uret(oturum, cihaz) -> str:
    yanit = await ajan.create_pairing_code(cihaz, oturum)
    return yanit.code


async def _esles(oturum, kod: str):
    return await ajan.pair_agent(AgentPairRequest(code=kod), oturum)


# --------------------------------------------------------------------------- #
# Eşleştirme
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_dogru_kod_token_veriyor(oturum, cihaz):
    kod = await _kod_uret(oturum, cihaz)
    sonuc = await _esles(oturum, kod)

    assert sonuc.device_id == cihaz.id
    assert sonuc.token.startswith("fbt_")
    # Token cihaz kimliğinin ilk sekiz karakterini taşımalı: sunucu doğru
    # cihazı bulmak için bunu kullanıyor
    assert sonuc.token.split("_")[1] == str(cihaz.id)[:8]


@pytest.mark.asyncio
async def test_kod_tek_kullanimlik(oturum, cihaz):
    kod = await _kod_uret(oturum, cihaz)
    await _esles(oturum, kod)

    # Aynı kodla ikinci kez eşleşilememeli; yoksa kodu gören herkes
    # istediği zaman kendi ajanını bağlayabilirdi
    with pytest.raises(Exception) as hata:
        await _esles(oturum, kod)
    assert hata.value.status_code == 401


@pytest.mark.asyncio
async def test_kucuk_harf_ve_bosluk_kabul_ediliyor(oturum, cihaz):
    kod = await _kod_uret(oturum, cihaz)
    # Kullanıcı ekrandan okuyup elle yazacak; büyük/küçük harf ve kenar
    # boşlukları yüzünden reddetmek gereksiz bir engel olurdu
    sonuc = await _esles(oturum, f"  {kod.lower()}  ")
    assert sonuc.token.startswith("fbt_")


@pytest.mark.asyncio
async def test_yanlis_kod_reddediliyor(oturum, cihaz):
    await _kod_uret(oturum, cihaz)
    with pytest.raises(Exception) as hata:
        await _esles(oturum, "AAAA-BBBB")
    assert hata.value.status_code == 401


@pytest.mark.asyncio
async def test_suresi_dolan_kod_calismiyor(oturum, cihaz):
    kod = await _kod_uret(oturum, cihaz)
    cihaz.pairing_code_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await oturum.commit()

    with pytest.raises(Exception) as hata:
        await _esles(oturum, kod)
    assert hata.value.status_code == 401


@pytest.mark.asyncio
async def test_deneme_siniri_kaba_kuvveti_kesiyor(oturum, cihaz):
    kod = await _kod_uret(oturum, cihaz)

    for _ in range(ajan.PAIRING_MAX_ATTEMPTS):
        with pytest.raises(Exception):
            await _esles(oturum, "ZZZZ-ZZZZ")

    # Sınır dolduktan sonra DOĞRU kod bile kabul edilmemeli
    with pytest.raises(Exception) as hata:
        await _esles(oturum, kod)
    assert hata.value.status_code == 401
    assert cihaz.pairing_attempts >= ajan.PAIRING_MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_kod_karisan_harfleri_icermiyor(oturum, cihaz):
    # 0/O ve 1/I/L ekrandan okunurken karışıyor; alfabede olmamalı
    for _ in range(30):
        kod = await _kod_uret(oturum, cihaz)
        assert not (set(kod) & set("01OIL")), kod
        assert len(kod) == ajan.PAIRING_LENGTH + 1  # araya konan tire


# --------------------------------------------------------------------------- #
# Token yenileme ve hoşgörü penceresi
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_yenilemeden_sonra_eski_token_bir_sure_gecerli(oturum, cihaz):
    eski = await _esles(oturum, await _kod_uret(oturum, cihaz))
    yeni = await ajan.rotate_agent_token(oturum, cihaz)

    assert yeni.token != eski.token
    # İkisi de çalışmalı: ajan yeni token'ı diskine yazamadan çökmüş olabilir
    assert (await ajan.authenticate_agent(oturum, yeni.token)).id == cihaz.id
    assert (await ajan.authenticate_agent(oturum, eski.token)).id == cihaz.id


@pytest.mark.asyncio
async def test_hosgoru_penceresi_dolunca_eski_token_olur(oturum, cihaz):
    eski = await _esles(oturum, await _kod_uret(oturum, cihaz))
    yeni = await ajan.rotate_agent_token(oturum, cihaz)

    cihaz.agent_token_rotated_at = (
        datetime.now(timezone.utc) - ajan.TOKEN_GRACE - timedelta(minutes=1)
    )
    await oturum.commit()

    assert (await ajan.authenticate_agent(oturum, yeni.token)).id == cihaz.id
    with pytest.raises(Exception) as hata:
        await ajan.authenticate_agent(oturum, eski.token)
    assert hata.value.status_code == 401


@pytest.mark.asyncio
async def test_iki_kez_yenileyince_en_eski_token_olur(oturum, cihaz):
    ilk = await _esles(oturum, await _kod_uret(oturum, cihaz))
    ikinci = await ajan.rotate_agent_token(oturum, cihaz)
    ucuncu = await ajan.rotate_agent_token(oturum, cihaz)

    assert (await ajan.authenticate_agent(oturum, ucuncu.token)).id == cihaz.id
    assert (await ajan.authenticate_agent(oturum, ikinci.token)).id == cihaz.id
    # Yalnızca BİR önceki tutuluyor; daha eskisi geçersiz
    with pytest.raises(Exception):
        await ajan.authenticate_agent(oturum, ilk.token)


@pytest.mark.asyncio
async def test_token_sonundaki_bosluk_gorunmezi_engellemiyor(oturum, cihaz):
    sonuc = await _esles(oturum, await _kod_uret(oturum, cihaz))
    # systemd birimi CRLF ile kaydedilirse token'ın sonuna satır sonu yapışıyor;
    # bu bir günümüzü almıştı, bir daha olmasın
    from app.api.v1.agent import current_agent_device

    cihazi_bul = await current_agent_device(oturum, sonuc.token + "\r\n")
    assert cihazi_bul.id == cihaz.id
