"""Manuel kontrol — jog pad, ev, pinler, sulama, acil durdurma.

Her uç nokta CeleryScript komutunu üretip robot geçidine verir; geçit komutu
gerçek robota (MQTT) ya da simülatöre yönlendirir.
Hareket içeren komutlar, acil durdurma kilidi açıkken reddedilir.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice, ensure_unlocked
from app.db.base import utcnow
from app.models import Device, Peripheral, PlantSpecies, Point, Sensor, Tool
from app.models.enums import LogLevel, PeripheralRole, PlantStage, PointType, SensorKind
from app.schemas.control import (
    CommandResponse,
    ExecuteSequenceRequest,
    HomeRequest,
    MoveAbsoluteRequest,
    MoveRelativeRequest,
    PinReadRequest,
    PinWriteRequest,
    RawCommandRequest,
    ServoRequest,
    SowRequest,
    SpotAction,
    SpotTaskRequest,
    SurveyRequest,
    WaterPointRequest,
)
from app.services import commands, gantry_studio, gateway, gunluk, machine_config
from app.services.mqtt import RpcError, RpcTimeoutError

router = APIRouter(prefix="/devices/{device_id}/control", tags=["Kontrol"])

# Arduino sensör verisini kendi döngüsünde bu aralıkla yayınlıyor
# (firmware/arduino/farmbot_sensors, döngü sonundaki `delay(2000)`).
# Kanallı bir sensörden ölçüm beklerken prob toprakta bundan uzun kalmalı.
ARDUINO_YAYIN_MS = 2000


async def _dispatch(
    device: Device,
    body: list[dict],
    *,
    wait: bool = True,
    priority: int = commands.DEFAULT_PRIORITY,
) -> CommandResponse:
    """Komutu robot geçidine verir ve hataları anlaşılır HTTP yanıtlarına çevirir.

    Geçit, gerçek robot (MQTT) ile sanal robot (simülatör) arasında seçim yapar;
    bu katmanın hangisinin çalıştığını bilmesi gerekmez.
    """
    try:
        response = await gateway.send(device, body, wait=wait, priority=priority)
    except RpcTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except RpcError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ConnectionError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return CommandResponse(
        ok=True,
        label=(response.get("args") or {}).get("label"),
        response=response,
    )


# --------------------------------------------------------------------------- #
# Hareket
# --------------------------------------------------------------------------- #

# Hareket komutlarında yanıt BEKLENMEZ.
#
# Gerçek donanımda bir hareket dakikalar sürebilir; istek boyunca beklemek
# arayüzü kilitler ve HTTP zaman aşımına yol açar. Bunun yerine komut sıraya
# konur ve ilerleme WebSocket'ten gelen canlı konumla izlenir — kullanıcı
# robotun hareket ettiğini zaten panelde görür.
@router.post("/move-relative", response_model=CommandResponse)
async def move_relative(payload: MoveRelativeRequest, device: OwnedDevice) -> CommandResponse:
    """Jog pad butonları bunu çağırır."""
    ensure_unlocked(device)
    return await _dispatch(
        device,
        [commands.move_relative(payload.x, payload.y, payload.z, payload.speed)],
        wait=False,
    )


@router.post("/move-absolute", response_model=CommandResponse)
async def move_absolute(payload: MoveAbsoluteRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    _assert_reachable(device, payload.x, payload.y)
    return await _dispatch(
        device,
        [commands.move_absolute(payload.x, payload.y, payload.z, payload.speed)],
        wait=False,
    )


@router.post("/home", response_model=CommandResponse)
async def go_home(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    step = (
        commands.find_home(payload.axis.value, payload.speed)
        if payload.find
        else commands.home(payload.axis.value, payload.speed)
    )
    # Ev arama uzun sürebilir; arayüzü bekletmeden gönder
    return await _dispatch(device, [step], wait=not payload.find)


@router.post("/calibrate", response_model=CommandResponse)
async def calibrate(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(device, [commands.calibrate(payload.axis.value)], wait=False)


@router.post("/set-zero", response_model=CommandResponse)
async def set_zero(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(device, [commands.set_zero(payload.axis.value)])


# --------------------------------------------------------------------------- #
# Pinler
# --------------------------------------------------------------------------- #

@router.post("/pin/write", response_model=CommandResponse)
async def write_pin(payload: PinWriteRequest, device: OwnedDevice) -> CommandResponse:
    """Pompa/vana/lamba aç-kapa. Kilit hareketi engeller ama pin yazmayı engellemez —
    acil durumda suyu kapatabilmek gerekir."""
    return await _dispatch(
        device, [commands.write_pin(payload.pin, payload.value, payload.mode)]
    )


@router.post("/pin/read", response_model=CommandResponse)
async def read_pin(payload: PinReadRequest, device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device, [commands.read_pin(payload.pin, payload.mode)])


@router.post("/servo", response_model=CommandResponse)
async def set_servo(payload: ServoRequest, device: OwnedDevice) -> CommandResponse:
    """Servoyu belirtilen açıya götürür.

    Kilit hareketi engellemez: servo gantry'yi hareket ettirmez, vana/kapak
    gibi bir işlevi vardır ve acil durumda kapatılabilmesi gerekir.
    """
    return await _dispatch(device, [commands.set_servo_angle(payload.pin, payload.angle)])


# --------------------------------------------------------------------------- #
# Sulama
# --------------------------------------------------------------------------- #

@router.post("/water", response_model=CommandResponse)
async def water_point(
    payload: WaterPointRequest, device: OwnedDevice, db: DbSession
) -> CommandResponse:
    """Belirtilen bitkiye gidip sular.

    Süre doğrudan `duration_ms` ile ya da `volume_ml` + sulama ucunun debisinden
    hesaplanarak belirlenir.
    """
    ensure_unlocked(device)

    result = await db.execute(
        select(Point).where(Point.id == payload.point_id, Point.device_id == device.id)
    )
    point = result.scalar_one_or_none()
    if point is None:
        raise HTTPException(404, detail="Bitki bulunamadı")

    # Pompayı **kullanıcının tanımından** buluyoruz.
    #
    # Önceden pin sabit 8 varsayılıyordu: panelde "Su pompası, pin 7" tanımlı
    # olsa bile sulama pin 8'i sürüyor, hiçbir şey olmuyor ve sebebi de
    # anlaşılmıyordu. İstek açıkça bir pin verirse ona saygı gösteriyoruz
    # (dizi editörü gibi ileri kullanımlar için), yoksa tanımlı su pompasını
    # arıyoruz.
    pompa = await _su_pompasi(db, device.id)
    if payload.pump_pin is None and pompa is None:
        raise HTTPException(
            422,
            detail=(
                "Su pompası tanımlı değil. Ayarlar → Çevre Birimleri'nden "
                "bir birim ekleyip görevini 'Su pompası' seçin."
            ),
        )
    pump_pin = payload.pump_pin if payload.pump_pin is not None else pompa.pin

    recete = dict(machine_config.normalize(device.settings)["irrigation"])

    # İstekte süre ya da hacim varsa reçetedeki süreyi **ezer**: "200 ml sula"
    # demek, reçetenin varsayılanını değil o hacmi istemek demektir.
    if payload.duration_ms is not None:
        recete["water_ms"] = payload.duration_ms
    elif payload.volume_ml is not None:
        recete["water_ms"] = await _duration_from_volume(
            db, device.id, payload.volume_ml, pompa
        )

    if not recete["water_ms"] and not recete["air_ms"]:
        raise HTTPException(
            422,
            detail=(
                "Sulama süresi sıfır. Ayarlar → Sulama Reçetesi'nden süre girin "
                "ya da istekte duration_ms/volume_ml verin."
            ),
        )

    # Hava pompası ve vana isteğe bağlı; tanımlı değillerse reçetedeki
    # adımları hiç üretmiyoruz
    hava = await _pompa_bul(db, device.id, PeripheralRole.AIR_PUMP)
    vana = await _pompa_bul(db, device.id, PeripheralRole.VALVE)

    # Sulama ucunu takıyoruz. Yuva tanımlı değilse bu adım atlanıyor —
    # tek uçlu bir makinede uç değiştirme diye bir şey yok.
    zone = await _uc_bolgesi(device)
    hazirlik = commands.uc_hazirla(
        _yuva_bul(zone, "waterer"),
        _takili_yuva(zone),
        zone,
        int(zone.get("change_speed", 20)),
    )

    body = hazirlik + commands.sulama_recetesi(
        x=point.x,
        y=point.y,
        soil_z=device.soil_height_mm,
        safe_z=device.safe_height_mm,
        recete=recete,
        water_pin=pump_pin,
        air_pin=hava.pin if hava else None,
        valve_pin=vana.pin if vana else None,
        speed=payload.speed,
    )
    await gunluk.yaz(
        db,
        device,
        gunluk.ozet(
            "Sulama başladı",
            bitki=point.name,
            süre=f"{recete['water_ms'] / 1000:.1f} sn",
            pin=pump_pin,
        ),
        level=LogLevel.SUCCESS,
        commit=True,
    )

    # Sulama uzun sürer; yanıtı bekleme, ilerleme WebSocket'ten izlenir
    return await _dispatch(device, body, wait=False)


async def _uc_bolgesi(device: Device) -> dict:
    """Uç bölgesi ayarları, koordinatlar Gantry Studio'dan tazelenmiş hâliyle.

    Saklanan kopyayla yetinmiyoruz: ortak Gantry Studio'da istasyonu
    kaydırdığında bizim değerimiz eskir ve kafa yuvayı sıyırırdı. Kayma sessiz
    olurdu — kimse "Eşitle"ye basmayı unuttuğunu fark etmez.

    Takılı ucun **hangisi** olduğunu da oradan alıyoruz: uç alma ve bırakma
    işini fiilen Gantry Studio yapıyor, dolayısıyla durumun sahibi o. Bizim
    kaydımız ancak ulaşılamadığında devreye giriyor.
    """
    zone = machine_config.normalize(device.settings)["tool_zone"]
    canli = await gantry_studio.uc_istasyonlari()
    if not canli.get("available"):
        return zone

    zone["slots"] = gantry_studio.tazele_yuvalar(
        zone.get("slots") or [],
        {y["name"]: {"x": y["x"], "y": y["y"], "z": y["z"]} for y in canli.get("slots", [])},
    )
    zone["current_tool"] = canli.get("current_tool")
    return zone


def _yuva_bul(zone: dict, gorev: str) -> dict | None:
    """Belirtilen görevdeki uç yuvası."""
    for yuva in zone.get("slots") or []:
        if yuva.get("role") == gorev:
            return yuva
    return None


def _takili_yuva(zone: dict) -> dict | None:
    ad = zone.get("current_tool")
    if not ad:
        return None
    for yuva in zone.get("slots") or []:
        if yuva.get("name") == ad:
            return yuva
    return None


async def _pompa_bul(
    db: DbSession, device_id: uuid.UUID, gorev: PeripheralRole
) -> Peripheral | None:
    """Belirtilen görevdeki çevre birimi."""
    result = await db.execute(
        select(Peripheral).where(
            Peripheral.device_id == device_id, Peripheral.role == gorev
        )
    )
    return result.scalars().first()


async def _su_pompasi(db: DbSession, device_id: uuid.UUID) -> Peripheral | None:
    return await _pompa_bul(db, device_id, PeripheralRole.WATER_PUMP)


async def _duration_from_volume(
    db: DbSession,
    device_id: uuid.UUID,
    volume_ml: int,
    pompa: Peripheral | None = None,
) -> int:
    """Su hacmini debiye bakarak milisaniyeye çevirir.

    Debi önce pompanın kendi kaydında aranıyor. Eskiden yalnızca `Tool`
    üzerinde tutuluyordu: pompa "Çevre Birimleri"nde, debisi "Aletler"de
    duruyordu ve ikisini eşleştiren bir şey yoktu. Eski kurulumlar bozulmasın
    diye alet tarafına da bakmaya devam ediyoruz.
    """
    if pompa is not None and pompa.flow_rate_ml_per_s:
        return int(volume_ml / pompa.flow_rate_ml_per_s * 1000)

    result = await db.execute(
        select(Tool).where(Tool.device_id == device_id, Tool.flow_rate_ml_per_s.is_not(None))
    )
    tool = result.scalars().first()
    if tool is None or not tool.flow_rate_ml_per_s:
        raise HTTPException(
            422,
            detail=(
                "Debi tanımlı değil. Ayarlar → Çevre Birimleri'nden su "
                "pompasına debi girin ya da süreyi doğrudan verin."
            ),
        )
    return int(volume_ml / tool.flow_rate_ml_per_s * 1000)


# --------------------------------------------------------------------------- #
# Tohum ekimi — vakumlu uç
# --------------------------------------------------------------------------- #

@router.post("/sow", response_model=CommandResponse)
async def sow_points(
    payload: SowRequest, device: OwnedDevice, db: DbSession
) -> CommandResponse:
    """Seçilen bitkileri vakumlu uçla eker.

    Her bitki için sıra: tepsiden tohumu al → hedefe git → çukura bırak.
    Tümü **tek** RPC gövdesi hâlinde gidiyor; robot adımları sırayla uyguluyor
    ve araya başka komut giremiyor. Yarıda kesilen bir ekim, ucunda tohum asılı
    duran bir robot bırakırdı.

    Uç yukarı kaldırma korumasını burada üretmiyoruz: o, ajanda her hareketin
    önünde zaten uygulanıyor (bkz. agent/gantry.py `move_xyz`).
    """
    ensure_unlocked(device)

    seeder = machine_config.normalize(device.settings)["seeder"]
    if not seeder["enabled"]:
        raise HTTPException(
            422,
            detail=(
                "Vakumlu tohum ucu tanımlı değil. "
                "Ayarlar → Tohum Ekimi'nden tepsi konumunu ve vakum pinini girin."
            ),
        )

    stmt = select(Point).where(
        Point.device_id == device.id,
        Point.point_type == PointType.PLANT,
        Point.discarded_at.is_(None),
    )
    if payload.point_ids:
        stmt = stmt.where(Point.id.in_(payload.point_ids))
    else:
        # Boş istek = "tasarımdaki henüz ekilmemişleri ek"
        stmt = stmt.where(Point.stage == PlantStage.PLANNED)

    points = list((await db.execute(stmt.order_by(Point.x, Point.y))).scalars().all())
    if not points:
        raise HTTPException(404, detail="Ekilecek bitki bulunamadı")

    x_min, x_max, y_min, y_max = machine_config.planting_bounds(device)
    disarida = [
        p.name for p in points if not (x_min <= p.x <= x_max and y_min <= p.y <= y_max)
    ]
    if disarida:
        raise HTTPException(
            422,
            detail=(
                f"{len(disarida)} bitki ekim alanının dışında "
                f"(X {x_min:.0f}–{x_max:.0f}, Y {y_min:.0f}–{y_max:.0f} mm): "
                + ", ".join(disarida[:5])
            ),
        )

    # Vakum kaynağı: kullanıcının tanımladığı birim. Sahada hava pompası
    # vakumu üretiyor, o yüzden "vakum" görevi yoksa hava pompasına düşüyoruz.
    # Ayarlardaki sabit pin son çare: birim tanımlıysa o geçerli.
    vakum = await _pompa_bul(db, device.id, PeripheralRole.VACUUM) or await _pompa_bul(
        db, device.id, PeripheralRole.AIR_PUMP
    )
    vakum_pin = vakum.pin if vakum else seeder["vacuum_pin"]

    zone = await _uc_bolgesi(device)
    hazirlik = commands.uc_hazirla(
        _yuva_bul(zone, "seeder"),
        _takili_yuva(zone),
        zone,
        int(zone.get("change_speed", 20)),
    )

    tray = (seeder["tray_x_mm"], seeder["tray_y_mm"], seeder["tray_z_mm"])
    # Uç bir kez alınıyor, sonra bütün tohumlar aynı uçla ekiliyor
    body: list[dict] = list(hazirlik)
    for point in points:
        # Derinlik önceliği: bitkiye özel > türün katalog değeri > ayarlardaki
        depth = point.depth_mm
        if depth is None and point.species is not None:
            depth = point.species.sow_depth_mm
        if depth is None:
            depth = seeder["default_depth_mm"]

        body.extend(
            commands.sow_at(
                x=point.x,
                y=point.y,
                soil_z=device.soil_height_mm,
                depth_mm=float(depth),
                tray=tray,
                vacuum_pin=vakum_pin,
                pick_dwell_ms=seeder["pick_dwell_ms"],
                release_dwell_ms=seeder["release_dwell_ms"],
                speed=payload.speed,
            )
        )

    if payload.mark_planted:
        # Komut gönderilmeden **önce** işaretliyoruz: gönderim uzun sürüyor ve
        # yanıt beklenmiyor. Sonra işaretleseydik kullanıcı ekim bitene kadar
        # aynı bitkileri ikinci kez sıraya sokabilirdi.
        planted_at = utcnow()
        for point in points:
            point.stage = PlantStage.PLANTED
            point.planted_at = planted_at
        await db.commit()

    await gunluk.yaz(
        db,
        device,
        gunluk.ozet("Tohum ekimi başladı", adet=len(points), hız=f"{payload.speed}"),
        level=LogLevel.SUCCESS,
        commit=True,
    )

    response = await _dispatch(device, body, wait=False)
    response.detail = f"{len(points)} tohum ekim sırasına alındı"
    return response


# --------------------------------------------------------------------------- #
# Noktada iş — serbest koordinat
# --------------------------------------------------------------------------- #
#
# `sow` ve `water` kayıtlı bir bitkiye bağlı çalışıyor. Tasarımda yeri olmayan
# bir noktayı denemek için önce bitki kaydı açmak gerekiyordu; deneme yapmak
# isteyen biri için gereksiz bir yol. Burası o boşluğu kapatıyor: koordinat
# gir, işi seç, robot gitsin.
#
# Üç iş de aynı iskeleti paylaşıyor — doğru ucu tak, noktaya git, işi yap —
# ama farklı uçlar ve farklı adımlar istiyor. Ayrı uç noktalar açmak yerine
# tek `action` alanı: arayüzde de tek bir kart, tek bir "Çalıştır" düğmesi.

@router.post("/spot", response_model=CommandResponse)
async def spot_task(
    payload: SpotTaskRequest, device: OwnedDevice, db: DbSession
) -> CommandResponse:
    """Verilen koordinata gidip seçilen işi yapar."""
    ensure_unlocked(device)
    _assert_reachable(device, payload.x, payload.y)

    ayarlar = machine_config.normalize(device.settings)
    zone = await _uc_bolgesi(device)
    hiz = payload.speed

    def hazirla(gorev: str) -> list[dict]:
        return commands.uc_hazirla(
            _yuva_bul(zone, gorev),
            _takili_yuva(zone),
            zone,
            int(zone.get("change_speed", 20)),
        )

    # --- Tohum bırak ------------------------------------------------------- #
    if payload.action == SpotAction.SOW:
        seeder = ayarlar["seeder"]
        if not seeder["enabled"]:
            raise HTTPException(
                422,
                detail=(
                    "Vakumlu tohum ucu tanımlı değil. Ayarlar → Vakumlu Uç'tan "
                    "tepsi konumunu ve vakum pinini girin."
                ),
            )

        # Ekim alanı yalnızca ekimde geçerli: sulama ve ölçüm yatağın her
        # yerinde yapılabilir, tohum ise metale düşmemeli.
        x_min, x_max, y_min, y_max = machine_config.planting_bounds(device)
        if not (x_min <= payload.x <= x_max and y_min <= payload.y <= y_max):
            raise HTTPException(
                422,
                detail=(
                    f"Nokta ekim alanının dışında "
                    f"(X {x_min:.0f}–{x_max:.0f}, Y {y_min:.0f}–{y_max:.0f} mm)."
                ),
            )

        derinlik = payload.depth_mm
        if derinlik is None and payload.species_id is not None:
            tur = await db.get(PlantSpecies, payload.species_id)
            if tur is not None:
                derinlik = float(tur.sow_depth_mm)
        if derinlik is None:
            derinlik = float(seeder["default_depth_mm"])

        vakum = await _pompa_bul(db, device.id, PeripheralRole.VACUUM) or await _pompa_bul(
            db, device.id, PeripheralRole.AIR_PUMP
        )
        body = hazirla("seeder") + commands.sow_at(
            x=payload.x,
            y=payload.y,
            soil_z=device.soil_height_mm,
            depth_mm=derinlik,
            tray=(seeder["tray_x_mm"], seeder["tray_y_mm"], seeder["tray_z_mm"]),
            vacuum_pin=vakum.pin if vakum else seeder["vacuum_pin"],
            pick_dwell_ms=seeder["pick_dwell_ms"],
            release_dwell_ms=seeder["release_dwell_ms"],
            speed=hiz,
        )
        ozet = gunluk.ozet(
            "Noktaya tohum bırakılıyor",
            konum=f"X{payload.x:.0f} Y{payload.y:.0f}",
            derinlik=f"{derinlik:.0f} mm",
        )
        detay = f"X{payload.x:.0f} Y{payload.y:.0f} noktasına tohum bırakılıyor"

    # --- Sula -------------------------------------------------------------- #
    elif payload.action == SpotAction.WATER:
        pompa = await _su_pompasi(db, device.id)
        if pompa is None:
            raise HTTPException(
                422,
                detail=(
                    "Su pompası tanımlı değil. Ayarlar → Çevre Birimleri'nden "
                    "bir birim ekleyip görevini 'Su pompası' seçin."
                ),
            )

        recete = dict(ayarlar["irrigation"])
        # İstekteki süre/hacim reçeteyi ezer: "200 ml" demek, reçetenin
        # varsayılanını değil o hacmi istemek demek.
        if payload.duration_ms is not None:
            recete["water_ms"] = payload.duration_ms
        elif payload.volume_ml is not None:
            recete["water_ms"] = await _duration_from_volume(
                db, device.id, payload.volume_ml, pompa
            )
        if recete["water_ms"] <= 0:
            raise HTTPException(
                422,
                detail=(
                    "Sulama süresi sıfır. Ayarlar → Sulama Reçetesi'nden süre girin "
                    "ya da süre/hacim verin."
                ),
            )

        # Reçetede "bitkinin üstüne git" kapalı olabilir; orada anlamı "sabit
        # hatta sula". Burada koordinat **istekle** geliyor, gitmemek işi
        # anlamsız kılardı.
        recete["go_to_plant"] = True

        hava = await _pompa_bul(db, device.id, PeripheralRole.AIR_PUMP)
        vana = await _pompa_bul(db, device.id, PeripheralRole.VALVE)
        body = hazirla("waterer") + commands.sulama_recetesi(
            x=payload.x,
            y=payload.y,
            soil_z=device.soil_height_mm,
            safe_z=device.safe_height_mm,
            recete=recete,
            water_pin=pompa.pin,
            air_pin=hava.pin if hava else None,
            valve_pin=vana.pin if vana else None,
            speed=hiz,
        )
        ozet = gunluk.ozet(
            "Noktada sulama",
            konum=f"X{payload.x:.0f} Y{payload.y:.0f}",
            süre=f"{recete['water_ms'] / 1000:.1f} sn",
            pin=pompa.pin,
        )
        detay = f"X{payload.x:.0f} Y{payload.y:.0f} noktası sulanıyor"

    # --- Toprak nemi ------------------------------------------------------- #
    else:
        sensor = await _toprak_sensoru(db, device.id, payload.sensor_id)
        if sensor is None:
            raise HTTPException(
                422,
                detail=(
                    "Toprak nemi sensörü bulunamadı. Sensörler sayfasından "
                    "kanalı 'toprak nemi' olan bir sensör tanımlayın."
                ),
            )
        # Pin yoksa bu bir **kanallı** sensör: Arduino kendi döngüsünde okuyup
        # sürekli yayınlıyor. Reddetmek yanlıştı — sahadaki toprak nemi
        # sensörü tam olarak böyle çalışıyor ve "bir pine bağlı değil" hatası
        # doğru kurulmuş bir donanımı arızalı gibi gösteriyordu.
        prob = ayarlar["probe"]
        derinlik = payload.probe_depth_mm
        if derinlik is None:
            derinlik = float(prob["depth_mm"])

        # Kanallı sensörden okuma isteyemiyoruz; ölçümün kendiliğinden
        # gelmesini bekliyoruz. Arduino iki saniyede bir yayın yapıyor, bu
        # yüzden prob toprakta en az bir tur kalmalı — yoksa o noktaya ait
        # hiçbir ölçüm oluşmaz ve komut sessizce hiçbir şey üretmez.
        bekleme = int(prob["settle_ms"])
        if sensor.pin is None:
            bekleme = max(bekleme, ARDUINO_YAYIN_MS * 2)

        body = hazirla("soil_probe") + commands.toprak_olc(
            x=payload.x,
            y=payload.y,
            soil_z=device.soil_height_mm,
            safe_z=device.safe_height_mm,
            depth_mm=derinlik,
            pin=sensor.pin,          # None ise okuma adımı üretilmiyor
            mode=sensor.mode,
            label=sensor.channel or sensor.label,
            settle_ms=bekleme,
            speed=hiz,
        )
        ozet = gunluk.ozet(
            "Noktada toprak ölçümü",
            konum=f"X{payload.x:.0f} Y{payload.y:.0f}",
            derinlik=f"{derinlik:.0f} mm",
            sensör=sensor.label,
        )
        detay = f"X{payload.x:.0f} Y{payload.y:.0f} noktasında nem ölçülüyor"

    await gunluk.yaz(db, device, ozet, level=LogLevel.SUCCESS, commit=True)

    # Yanıt beklenmiyor: uç alma dahil bütün dizi bir dakikayı bulabiliyor ve
    # ilerleme zaten WebSocket'ten izleniyor.
    response = await _dispatch(device, body, wait=False)
    response.detail = detay
    return response


async def _toprak_sensoru(
    db: DbSession, device_id: uuid.UUID, sensor_id: uuid.UUID | None
) -> Sensor | None:
    """Ölçümü alacak sensör.

    İstek açıkça birini verirse o geçerli. Vermezse toprak nemi türündeki
    **takılı** sensör aranıyor: takılı olmayan kanal gürültü üretiyor ve
    ölçüm anlamsız bir sayı yazardı.
    """
    stmt = select(Sensor).where(Sensor.device_id == device_id)
    if sensor_id is not None:
        stmt = stmt.where(Sensor.id == sensor_id)
    else:
        stmt = stmt.where(
            Sensor.kind == SensorKind.SOIL_MOISTURE,
            Sensor.installed.is_(True),
        )
    return (await db.execute(stmt.order_by(Sensor.created_at))).scalars().first()


# --------------------------------------------------------------------------- #
# Kamera ve sistem
# --------------------------------------------------------------------------- #

@router.post("/take-photo", response_model=CommandResponse)
async def take_photo(device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device, [commands.take_photo()], wait=False)


@router.post("/emergency-lock", response_model=CommandResponse)
async def emergency_lock(device: OwnedDevice, db: DbSession) -> CommandResponse:
    """ACİL DURDURMA. En yüksek öncelikle gider ve yanıt beklenmez."""
    device.is_locked = True
    await gunluk.yaz(
        db, device, "ACİL DURDURMA — tüm hareket kesildi", level=LogLevel.ERROR
    )
    await db.commit()
    return await _dispatch(
        device,
        [commands.emergency_lock()],
        wait=False,
        priority=commands.EMERGENCY_PRIORITY,
    )


@router.post("/emergency-unlock", response_model=CommandResponse)
async def emergency_unlock(device: OwnedDevice, db: DbSession) -> CommandResponse:
    device.is_locked = False
    await gunluk.yaz(db, device, "Acil kilit açıldı", level=LogLevel.WARN)
    await db.commit()
    return await _dispatch(
        device,
        [commands.emergency_unlock()],
        wait=False,
        priority=commands.EMERGENCY_PRIORITY,
    )


@router.post("/reboot", response_model=CommandResponse)
async def reboot(device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device, [commands.reboot()], wait=False)


@router.post("/execute", response_model=CommandResponse)
async def execute_sequence(
    payload: ExecuteSequenceRequest, device: OwnedDevice
) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(
        device, [commands.execute_sequence(payload.sequence_id)], wait=False
    )


@router.post("/survey", response_model=CommandResponse)
async def survey(
    payload: SurveyRequest, device: OwnedDevice, db: DbSession
) -> CommandResponse:
    """Ölçüm turu: robotu ızgara üzerinde gezdirip her durakta sensörü okur.

    Isı haritasının anlamlı olabilmesi için bahçenin farklı noktalarından
    ölçüm gerekir; bu uç nokta o veriyi tek komutla toplar.
    """
    ensure_unlocked(device)

    result = await db.execute(
        select(Sensor).where(Sensor.id == payload.sensor_id, Sensor.device_id == device.id)
    )
    sensor = result.scalar_one_or_none()
    if sensor is None:
        raise HTTPException(404, detail="Sensör bulunamadı")

    # Kenarlardan biraz içeriden başla: robot sınıra dayanmasın
    margin = 200
    usable_x = max(0, device.bed_width_mm - margin * 2)
    usable_y = max(0, device.bed_length_mm - margin * 2)

    body: list[dict] = []
    for row in range(payload.rows):
        y = margin + (usable_y * row / max(1, payload.rows - 1))
        # Yılan (boustrophedon) deseni: her sırada yön değişir, yol kısalır
        columns = range(payload.columns) if row % 2 == 0 else reversed(range(payload.columns))
        for column in columns:
            x = margin + (usable_x * column / max(1, payload.columns - 1))
            body.append(commands.move_absolute(round(x), round(y), device.safe_height_mm, payload.speed))
            body.append(commands.read_pin(sensor.pin, sensor.mode, sensor.label))

    stops = payload.rows * payload.columns
    response = await _dispatch(device, body, wait=False)
    response.detail = f"{stops} noktada ölçüm turu başlatıldı"
    return response


@router.post("/raw", response_model=CommandResponse)
async def raw_command(payload: RawCommandRequest, device: OwnedDevice) -> CommandResponse:
    """Dizi editöründe "şimdi çalıştır" önizlemesi için ham CeleryScript."""
    ensure_unlocked(device)
    return await _dispatch(device, payload.body, wait=payload.wait_for_response)


def _assert_reachable(device, x: float, y: float) -> None:
    if not (0 <= x <= device.bed_width_mm) or not (0 <= y <= device.bed_length_mm):
        raise HTTPException(
            422,
            detail=(
                f"Hedef çalışma alanı dışında "
                f"(X: 0–{device.bed_width_mm}, Y: 0–{device.bed_length_mm} mm)"
            ),
        )
