# PLC brief — paste this into the other chat

I'm working on the web control app for a 3-axis Cartesian farm gantry robot.
Below is the complete, verified PLC interface. Please read all of it before
changing any motion code, and don't invent addresses — every one you need is
here.

---

## 1. Connection

| Setting | Value |
|---|---|
| Protocol | Modbus-TCP |
| IP | `192.168.1.88` |
| Port | `502` |
| Unit / slave ID | `1` |
| Move mode | absolute |
| Global enable register | `1010` (write 1 to enable, 0 to disable) |

Axis mapping: **X = Axis_1, Y = Axis_2, Z = Axis_3**. Everything at the app
level is in **millimetres**; conversion to PLC counts happens at the register
write.

---

## 2. Register map (holding registers)

| | jog+ | jog− | go | home | target | vel | accel | decel | pos |
|---|---|---|---|---|---|---|---|---|---|
| **X** | 1020 | 1021 | 1022 | 1023 | 1024/25 | **1006/07** | **1000/01** | **1002/03** | 1026/27 |
| **Y** | 1030 | 1031 | 1032 | 1033 | 1034/35 | 1036/37 | 1038/39 | 1040/41 | 1042/43 |
| **Z** | 1050 | 1051 | 1052 | 1053 | 1054/55 | 1056/57 | 1058/59 | 1060/61 | 1062/63 |

Not yet wired — `0` means unmapped and the app must treat it as a harmless
no-op, not an error:

| Purpose | Value |
|---|---|
| Tool presence sensor | `presence_reg = 0` |
| Z-top safe switch | `z_safe_reg = 0` |
| Locking servo | `lock_reg = 0` (1 = lock, 0 = release) |

---

## 3. ⚠ THE MOST IMPORTANT THING — X does not use the same stride as Y and Z

Y is based at 1030 and Z at 1050, both with a clean layout:

```
base+0  jogf     base+3  home        base+8   accel
base+1  jogb     base+4  target      base+10  decel
base+2  go       base+6  vel         base+12  pos
```

**X does not follow this.** X is based at 1020, but only its jog/go/home/target
live there. Its `pos` is at base+6 — where Y and Z keep `vel` — and its
vel/accel/decel were relocated down to **1000–1007**.

If you assume one uniform layout and compute X's addresses as 1020+offset:

```
assumed X vel   -> 1026   which is actually  X pos
assumed X accel -> 1028   unused gap
assumed X decel -> 1030   which is actually  Y JOG FORWARD    ← breaks the machine
assumed X decel -> 1031   which is actually  Y JOG BACKWARD   ← breaks the machine
assumed X pos   -> 1032   which is actually  Y GO
```

This has already bitten us: commanding X made Y move. Writing X's deceleration
of 100.0 mm/s² as a float puts low word `0` at 1030 and high word `17096` at
1031 — so **Y jog backward latches on and Y runs continuously**. Any nonzero
speed or accel value does this (20.0 → 16800, 50.0 → 16968).

**Never compute X's addresses from a stride. Look them up in the table.**

---

## 4. Data formats

**32-bit values** (`target`, `vel`, `accel`, `decel`, `pos`) occupy two
consecutive registers, **low word first**, IEEE-754 float32:

```python
def write_f32(mb, base, value):
    bits = struct.unpack(">I", struct.pack(">f", float(value)))[0]
    mb.write(base,     bits & 0xFFFF)          # low word first
    mb.write(base + 1, (bits >> 16) & 0xFFFF)

def read_f32(mb, base):
    r = mb.read(base, 2)
    return struct.unpack(">f", struct.pack(">I", (r[1] << 16) | r[0]))[0]
```

**`go` and `home` are pulsed**, not levels — write 1, wait, write 0:

```python
mb.write(axis["go"], 1); time.sleep(0.12); mb.write(axis["go"], 0)     # go
mb.write(axis["home"], 1); time.sleep(0.20); mb.write(axis["home"], 0) # home
```

**`jog+` / `jog−` are levels**, not pulses — write 1 to start, 0 to stop. If you
never write the 0, the axis keeps going.

**`target`, `vel`, `accel`, `decel` are all in PLC counts**, never mm. Multiply
by that axis's counts-per-mm before writing.

---

## 5. Calibration — the source of truth is `gantry_calib.json` on the Pi

Read it at runtime. Do not hardcode these; Z in particular has been recalibrated
already. Current values as of the latest calibration screen:

| Axis | counts/mm | dir | home mm | min mm | max mm |
|---|---|---|---|---|---|
| X | 7.1371 | +1 | 0 | 0 | **425** |
| Y | 2.2054 | +1 | 0 | 0 | **450** |
| Z | 56.9 | **−1** | 440 | 0 | **550** |

The file is a JSON array in X, Y, Z order:

```json
[{"cpm": 7.1371, "dir": 1, "home": 0, "min": 0, "max": 425}, ...]
```

Conversions — use exactly these, the sign convention matters:

```python
def mm_from_raw(c, raw):
    return c["dir"] * raw / (c["cpm"] or 1) + c["home"]

def raw_from_mm(c, mm):
    return c["dir"] * (mm - c["home"]) * (c["cpm"] or 1)
```

**Soft limits must be enforced in the app before every move.** The PLC will not
stop you:

```python
def in_limits(c, mm):
    return (c["min"] - 0.5) <= mm <= (c["max"] + 0.5)
```

⚠ Our current UI shows X and Y ranges of 0–550, which is **wrong** — the real
travel is X 425 and Y 450. Commanding 550 on either axis drives it past the soft
limit into a hard stop. Fix the UI ranges to read from the calibration file.

---

## 6. Command sequences

**Jog** (button held down):

```python
mb.write(axis["jogf"], 1)   # or jogb
# ... on release:
mb.write(axis["jogf"], 0)
```

**Move to an absolute mm position:**

```python
cpm = c["cpm"]
write_f32(mb, axis["accel"], accel_mm_s2 * cpm)
write_f32(mb, axis["decel"], decel_mm_s2 * cpm)
write_f32(mb, axis["vel"],   abs(speed_mm_s * cpm))
write_f32(mb, axis["target"], raw_from_mm(c, target_mm))
mb.write(axis["go"], 1); time.sleep(0.12); mb.write(axis["go"], 0)
```

Order matters: accel/decel/vel/target must all be set **before** the go pulse.

**Home:** pulse the `home` register. Homing drives to the limit switches at full
travel, so never home an axis whose direction or scale you haven't verified by
jogging first.

**Emergency stop:** clear every jog bit on every axis, then write 0 to 1010.

```python
for a in axes:
    mb.write(a["jogf"], 0); mb.write(a["jogb"], 0)
mb.write(1010, 0)
```

---

## 7. Safety constraint you must not design around

The tool head **cannot drop straight down** onto a tool. It slides **under** the
tool from the side, along the **Y axis only**, and a servo then locks it on.

All X/Y travel must happen at **travel_z**, a clearance height above the tallest
tool. Combining X/Y travel with a Z descent near the tool area drags the head
through the tools lined up in between and crashes them. This has already
happened repeatedly.

The pick sequence is five segregated moves:

```
① raise Z to travel_z              (Z only)
② move X/Y to the approach point   (XY only, still at travel_z)
③ lower Z to engage height         (Z only, beside the tool)
④ slide under the tool             (Y only — X and Z stay constant)
⑤ servo locks, then lift by "lift" (pull the tool off its cradle)
```

Drop-off is the exact reverse. Please don't propose any motion that violates
this.

---

## 8. Known bugs — don't reintroduce these

1. **Uniform-stride X addressing.** Section 3. This is the live bug.
2. **UI travel limits of 550 on X and Y.** Section 5. Real limits are 425/450.
3. `mb.write(reg, [1 if state else 0])` — a list is passed where an int is
   expected, inside a bare `except: pass`, so the locking servo command throws
   and is silently swallowed. Pass an int.
4. Checking only the HTTP status code and ignoring the `ok` field in the JSON
   body. The app returns HTTP 200 with `{"ok": false, "error": ...}` on failure,
   so status-only checks report success on every error.

---

## 9. How to verify before you trust anything

There's a read-only tool, `plc_map.py`, safe to run while the machine is live:

```bash
python3 plc_map.py check                    # overlap analysis, no PLC needed
python3 plc_map.py dump --ip 192.168.1.88   # annotated register table
python3 plc_map.py watch --ip 192.168.1.88  # prints only registers that CHANGE
```

`watch` is the decisive test: jog one axis and see which registers move. Any
register belonging to an axis you did not command is a bug. If 1030 or 1031
changes while you jog X, that's the stride bug in section 3.

---

Please tell me what you're going to change before you change it, and keep the
E-stop within reach on the first move after any address edit.
