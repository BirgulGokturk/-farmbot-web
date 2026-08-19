"""Güvenli geçiş yüksekliği testleri.

Bu davranışın kırılması sessiz ve pahalı: uç aşağıdayken yatayda giden robot
yoldaki her bitkiyi biçer ve bunu kimse fark etmeden yapar. Bu yüzden adım
sırasını doğrudan doğruluyoruz.
"""

import asyncio

from gantry import GantryClient


class SahteGantry(GantryClient):
    """Gerçek makineye gitmeden gönderilen adımları toplar."""

    def __init__(self, konum):
        super().__init__()
        self._konum = konum
        self.adimlar = []

    async def position(self):
        return self._konum

    async def command(self, payload):
        self.adimlar.append(tuple(round(v, 1) for v in payload["target"]))


def rota(baslangic, hedef, safe_z, *, guard=True):
    g = SahteGantry(baslangic)
    g.safe_z = safe_z
    g.travel_guard = guard
    asyncio.run(g.move_xyz(*hedef, 30))
    return g.adimlar


def test_yatay_harekette_once_yukari_sonra_yatay_sonra_asagi():
    adimlar = rota((100.0, 100.0, -50.0), (900.0, 400.0, -30.0), safe_z=0.0)
    assert adimlar == [
        (100.0, 100.0, 0.0),   # 1) olduğu yerde yukarı
        (900.0, 400.0, 0.0),   # 2) yukarıdayken yatayda git
        (900.0, 400.0, -30.0),  # 3) varınca in
    ], adimlar


def test_uc_zaten_yukaridayken_bosuna_adim_atilmaz():
    adimlar = rota((100.0, 100.0, 0.0), (900.0, 400.0, -30.0), safe_z=0.0)
    assert adimlar == [(900.0, 400.0, 0.0), (900.0, 400.0, -30.0)], adimlar


def test_sadece_z_hareketinde_koruma_devreye_girmez():
    # Jog ile ucu indirmek: X/Y sabit olduğu için önce yukarı çıkmak saçma olurdu
    adimlar = rota((100.0, 100.0, 0.0), (100.0, 100.0, -80.0), safe_z=0.0)
    assert adimlar == [(100.0, 100.0, -80.0)], adimlar


def test_yukseklik_girilmemisse_davranis_eskisiyle_ayni():
    adimlar = rota((100.0, 100.0, -50.0), (900.0, 400.0, -30.0), safe_z=None)
    assert adimlar == [(900.0, 400.0, -30.0)], adimlar


def test_koruma_kapatilabilir():
    adimlar = rota((100.0, 100.0, -50.0), (900.0, 400.0, -30.0), safe_z=0.0, guard=False)
    assert adimlar == [(900.0, 400.0, -30.0)], adimlar


def test_hedef_zaten_guvenli_yukseklikteyse_inis_adimi_atlanir():
    adimlar = rota((100.0, 100.0, -50.0), (900.0, 400.0, 0.0), safe_z=0.0)
    assert adimlar == [(100.0, 100.0, 0.0), (900.0, 400.0, 0.0)], adimlar


def test_konum_okunamazsa_makine_kilitlenmez():
    g = SahteGantry(None)
    g.safe_z = 0.0
    asyncio.run(g.move_xyz(900.0, 400.0, -30.0, 30))
    # Korumasız ama beklenen hareket yine de yapılıyor
    assert g.adimlar == [(900.0, 400.0, -30.0)], g.adimlar


def test_x_eve_donerken_uc_once_kaldirilir():
    g = SahteGantry((100.0, 100.0, -50.0))
    g.safe_z = 0.0
    komutlar = []
    g.command = lambda p: komutlar.append(p) or asyncio.sleep(0)
    asyncio.run(g.go_home("x"))
    assert komutlar[0]["target"] == [100.0, 100.0, 0.0], komutlar
    assert komutlar[1] == {"cmd": "gohome", "axis": 0}, komutlar


def test_xy_eve_donerken_uc_once_kaldirilir_z_eve_gitmez():
    """Jog pad'in ortasındaki ev düğmesi Z'yi eve göndermemeli.

    Kullanıcı yatay tuşların ortasındaki düğmeye basarken Z'nin oynamasını
    beklemiyor; takılı bir uç varken hiç istemiyor.
    """
    g = SahteGantry((100.0, 100.0, -50.0))
    g.safe_z = 0.0
    komutlar = []
    g.command = lambda p: komutlar.append(p) or asyncio.sleep(0)
    asyncio.run(g.go_home("xy"))

    assert komutlar[0]["target"] == [100.0, 100.0, 0.0], komutlar
    # Yalnızca X (0) ve Y (1); Z (2) yok
    eksenler = [k["axis"] for k in komutlar if k.get("cmd") == "gohome"]
    assert eksenler == [0, 1], eksenler


def test_tum_eksen_eve_donuste_once_z_gider():
    g = SahteGantry((100.0, 100.0, -50.0))
    komutlar = []
    g.command = lambda p: komutlar.append(p) or asyncio.sleep(0)
    asyncio.run(g.go_home("all"))
    eksenler = [k["axis"] for k in komutlar if k.get("cmd") == "gohome"]
    # Z önce: yoksa alet toprakta sürünerek yatay harekete başlar
    assert eksenler == [2, 0, 1], eksenler


if __name__ == "__main__":
    gecen = 0
    for ad, fn in sorted(globals().items()):
        if ad.startswith("test_"):
            fn()
            gecen += 1
            print(f"  gecti: {ad}")
    print(f"\n{gecen} test gecti")