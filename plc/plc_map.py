#!/usr/bin/env python3
"""
plc_map.py — find out what your PLC registers actually are. Read-only.

Three modes:

  dump    read 1000..1075 once and print every word, decoded as both integer
          and 32-bit float, labelled with what gantry_studio.py believes it is

  watch   poll continuously and print only what CHANGES. Jog X from the website
          and watch which registers move. This is the one that settles the
          argument: if Y's registers change while you command X, you'll see it.

  check   pure logic, no PLC needed. Takes an address map and reports any two
          fields that overlap. Run this against the other app's map.

Nothing here writes to the PLC. You can run it while the machine is live.

    python3 plc_map.py dump
    python3 plc_map.py watch
    python3 plc_map.py check
    python3 plc_map.py dump --ip 192.168.1.88 --port 502 --lo 1000 --hi 1075
"""

import argparse
import socket
import struct
import sys
import time

# What gantry_studio.py believes. Each entry: (address, label, width_in_words)
GANTRY_MAP = {
    "X": {"jogf": 1020, "jogb": 1021, "go": 1022, "home": 1023,
          "target": 1024, "vel": 1006, "accel": 1000, "decel": 1002, "pos": 1026},
    "Y": {"jogf": 1030, "jogb": 1031, "go": 1032, "home": 1033,
          "target": 1034, "vel": 1036, "accel": 1038, "decel": 1040, "pos": 1042},
    "Z": {"jogf": 1050, "jogb": 1051, "go": 1052, "home": 1053,
          "target": 1054, "vel": 1056, "accel": 1058, "decel": 1060, "pos": 1062},
}
ENABLE_REG = 1010

# 32-bit values occupy two consecutive words, low word first.
WIDE = {"target", "vel", "accel", "decel", "pos"}


def build_labels(amap=None, enable=ENABLE_REG):
    amap = amap or GANTRY_MAP
    lab = {enable: "GLOBAL enable"}
    for axis, fields in amap.items():
        for field, addr in fields.items():
            lab[addr] = f"{axis} {field}" + (" (low)" if field in WIDE else "")
            if field in WIDE:
                lab[addr + 1] = f"{axis} {field} (high)"
    return lab


class Modbus:
    """Same wire format as gantry_studio.py, reads only."""

    def __init__(self, ip, port, unit):
        self.ip, self.port, self.unit = ip, port, unit
        self.sock = None
        self.tid = 0

    def connect(self):
        self.sock = socket.create_connection((self.ip, self.port), timeout=3)
        self.sock.settimeout(3)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def _recv(self, n):
        b = b""
        while len(b) < n:
            c = self.sock.recv(n - len(b))
            if not c:
                raise IOError("PLC closed the connection")
            b += c
        return b

    def read(self, addr, count):
        if self.sock is None:
            self.connect()
        self.tid = (self.tid + 1) & 0xFFFF
        pdu = struct.pack(">BHH", 3, addr, count)
        self.sock.sendall(struct.pack(">HHHB", self.tid, 0, len(pdu) + 1, self.unit) + pdu)
        h = self._recv(7)
        _, _, ln, _ = struct.unpack(">HHHB", h)
        body = self._recv(ln - 1)
        if body[0] & 0x80:
            raise IOError("modbus exception %d" % body[1])
        bc = body[1]
        return list(struct.unpack(">" + "H" * (bc // 2), body[2:2 + bc]))


def as_float(lo, hi):
    try:
        return struct.unpack(">f", struct.pack(">I", (hi << 16) | lo))[0]
    except Exception:
        return None


def as_i32(lo, hi):
    v = (hi << 16) | lo
    return v - 0x1_0000_0000 if v >= 0x8000_0000 else v


def cmd_dump(args):
    mb = Modbus(args.ip, args.port, args.unit)
    n = args.hi - args.lo + 1
    regs = read_span(mb, args.lo, n)
    labels = build_labels()

    print(f"\n  {args.ip}:{args.port} unit {args.unit}   registers {args.lo}..{args.hi}\n")
    print(f"  {'addr':>5}  {'word':>6}  {'as int32':>12}  {'as float32':>14}   label")
    print("  " + "-" * 72)
    for i, w in enumerate(regs):
        addr = args.lo + i
        lo, hi = w, regs[i + 1] if i + 1 < len(regs) else 0
        f = as_float(lo, hi)
        fs = "" if f is None or abs(f) > 1e12 else f"{f:14.4f}"
        label = labels.get(addr, "")
        flag = "" if (w or label) else ""
        print(f"  {addr:5d}  {w:6d}  {as_i32(lo, hi):12d}  {fs:>14}   {label}{flag}")
    print("\n  32-bit fields read low word first, so the float column on a *_low"
          "\n  row is the real value; the row after it is that same value's high half.\n")


def read_span(mb, lo, n):
    """Modbus caps one read at 125 registers, so chunk if needed."""
    out = []
    while n > 0:
        c = min(120, n)
        out += mb.read(lo + len(out), c)
        n -= c
    return out


def cmd_watch(args):
    mb = Modbus(args.ip, args.port, args.unit)
    labels = build_labels()
    n = args.hi - args.lo + 1
    prev = read_span(mb, args.lo, n)

    print(f"\n  watching {args.lo}..{args.hi} on {args.ip}:{args.port}")
    print("  Now jog ONE axis from the website. Every register that changes prints below.")
    print("  Anything belonging to an axis you did NOT command is your bug.\n")
    print(f"  {'time':>8}  {'addr':>5}  {'from':>6} -> {'to':>6}   label")
    print("  " + "-" * 62)

    seen = {}
    t0 = time.time()
    try:
        while True:
            time.sleep(max(0.05, 1.0 / args.hz))
            try:
                cur = read_span(mb, args.lo, n)
            except Exception as e:
                print(f"  read failed: {e}")
                mb.sock = None
                time.sleep(1)
                continue
            for i, (a, b) in enumerate(zip(prev, cur)):
                if a == b:
                    continue
                addr = args.lo + i
                label = labels.get(addr, "")
                # A live position register changes constantly; don't drown the
                # output in it, just note it once.
                if "pos" in label:
                    if seen.get(addr):
                        continue
                    seen[addr] = True
                    label += "   [live feedback, further changes hidden]"
                print(f"  {time.time()-t0:8.2f}  {addr:5d}  {a:6d} -> {b:6d}   {label}")
            prev = cur
    except KeyboardInterrupt:
        print("\n  stopped\n")


def cmd_check(args):
    """Overlap detector. No PLC required — pure arithmetic on the map."""
    amap = GANTRY_MAP
    claimed = {}          # address -> list of "AXIS field"
    for axis, fields in amap.items():
        for field, addr in fields.items():
            width = 2 if field in WIDE else 1
            for k in range(width):
                claimed.setdefault(addr + k, []).append(f"{axis} {field}")
    claimed.setdefault(ENABLE_REG, []).append("GLOBAL enable")

    clashes = {a: who for a, who in claimed.items() if len(who) > 1}
    print("\n  Overlap check on the gantry_studio.py map")
    if clashes:
        print("  COLLISIONS FOUND:")
        for a in sorted(clashes):
            print(f"    {a}: {' AND '.join(clashes[a])}")
    else:
        print("  no collisions — every field owns its own register\n")

    # Now the important part: what a uniform-stride assumption would do.
    print("  What happens if an app assumes all three axes use the same layout")
    print("  as Y and Z (base+0 jogf, +1 jogb, +2 go, +3 home, +4 target,")
    print("  +6 vel, +8 accel, +10 decel, +12 pos) with X based at 1020:\n")
    offs = {"jogf": 0, "jogb": 1, "go": 2, "home": 3, "target": 4,
            "vel": 6, "accel": 8, "decel": 10, "pos": 12}
    real = build_labels()
    print(f"    {'assumed X field':<16} {'addr':>5}   actually is")
    print("    " + "-" * 56)
    for field, off in offs.items():
        addr = 1020 + off
        width = 2 if field in WIDE else 1
        for k in range(width):
            owner = real.get(addr + k, "unused")
            mark = "  <-- WRONG AXIS" if owner.startswith(("Y ", "Z ")) else ""
            tag = f"X {field}" + (" (low)" if width == 2 and k == 0 else
                                  " (high)" if width == 2 else "")
            print(f"    {tag:<16} {addr+k:5d}   {owner}{mark}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["dump", "watch", "check"])
    ap.add_argument("--ip", default="192.168.1.88")
    ap.add_argument("--port", type=int, default=502)
    ap.add_argument("--unit", type=int, default=1)
    ap.add_argument("--lo", type=int, default=1000)
    ap.add_argument("--hi", type=int, default=1075)
    ap.add_argument("--hz", type=float, default=5.0)
    args = ap.parse_args()

    if args.mode == "check":
        return cmd_check(args)
    try:
        return cmd_dump(args) if args.mode == "dump" else cmd_watch(args)
    except OSError as e:
        print(f"\n  cannot reach the PLC at {args.ip}:{args.port} — {e}")
        print("  From the Pi:  ping 192.168.1.88")
        print("  A PLC will answer ping with its Modbus server switched off,")
        print("  so a successful read here is the only real proof.\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
