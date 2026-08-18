#!/usr/bin/env python3
"""Eksen eşlemesini bulmak için tanılama aracı.

Panelde X'e basınca fiziksel Z hareket ediyorsa, Gantry Studio'nun eksen
sırası makinedeki fiziksel sırayla aynı değil demektir. Bu araç her ekseni
tek tek küçük bir miktar oynatıp hangisinin ne olduğunu belirlemenizi sağlar.

Kullanım:
    python3 eksen_bul.py

GÜVENLİK: Her adımda onay ister ve varsayılan adım 10 mm'dir.
Acil durdurma butonunuz elinizin altında olsun.
"""

from __future__ import annotations

import json
import sys
import urllib.request

BASE = "http://localhost:8091"
ADIM_MM = 10.0


def istek(yol: str, veri: dict | None = None) -> dict:
    url = f"{BASE}{yol}"
    if veri is None:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read())
    gonder = json.dumps(veri).encode()
    req = urllib.request.Request(url, gonder, {"Content-Type": "application/json"})
    # Hareket bitene kadar bekler
    with urllib.request.urlopen(req, timeout=200) as r:
        return json.loads(r.read())


def konumlar() -> list[float]:
    durum = istek("/api/status")
    return [float(a.get("pos", 0)) for a in durum.get("axes", [])[:3]]


def main() -> int:
    try:
        baslangic = konumlar()
    except Exception as exc:
        print(f"Gantry Studio'ya ulasilamiyor: {exc}")
        print("Servis calisiyor mu?  systemctl status gantry-studio")
        return 1

    print("=" * 60)
    print("  EKSEN BULMA ARACI")
    print("=" * 60)
    print(f"Baslangic konumlari: {[round(p, 1) for p in baslangic]}")
    print(f"Her eksen {ADIM_MM:.0f} mm oynatilacak.")
    print("ACIL DURDURMA butonunuz elinizin altinda olsun.\n")

    sonuc: dict[str, int] = {}

    for dizin in range(3):
        cevap = input(f"[{dizin}] numarali ekseni oynatalim mi? (e/h/q): ").strip().lower()
        if cevap == "q":
            break
        if cevap != "e":
            continue

        once = konumlar()
        try:
            hedef = list(once)
            hedef[dizin] = once[dizin] + ADIM_MM
            istek("/api/cmd", {"cmd": "movexyz", "target": hedef, "speed": 10})
        except Exception as exc:
            print(f"   Hareket basarisiz: {exc}\n")
            continue

        sonra = konumlar()
        degisim = [round(sonra[i] - once[i], 1) for i in range(3)]
        print(f"   Konum degisimi: {degisim}")

        eksen = input("   HANGI fiziksel eksen hareket etti? (x/y/z/hicbiri): ").strip().lower()
        if eksen in ("x", "y", "z"):
            sonuc[eksen] = dizin
            print(f"   -> panel '{eksen}' = makine ekseni {dizin}\n")
        else:
            print("   -> atlandi\n")

    if len(sonuc) == 3:
        print("=" * 60)
        print("SONUC — gantry_axes.json icindeki 'map' bolumunu soyle yapin:\n")
        print(json.dumps({"map": sonuc}, indent=2))
        print("\nSonra:  sudo systemctl restart farmbot-agent")
        print("=" * 60)
    else:
        print(f"Eksik esleme ({len(sonuc)}/3). Tekrar calistirabilirsiniz.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
