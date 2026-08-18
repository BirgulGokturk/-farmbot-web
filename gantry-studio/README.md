# Making Gantry Studio fast on the LAN

Everything stays local. No cloud, no broker, no extra service — this patches the
app you already have.

## Install

```bash
cd ~/gantry_pi
python3 speedup_patch.py                    # patches ./gantry_studio.py
sudo systemctl restart gantry-studio
```

It checks all thirteen anchors before writing anything, so it either applies
cleanly or changes nothing and tells you. A timestamped `.bak` is kept beside
the file.

```bash
python3 speedup_patch.py --dry-run          # see what it would do
python3 speedup_patch.py --revert           # put the original back
```

Revert was tested: the restored file is byte-identical to the one you sent.

## Measured, patched vs your current file, both against the same PLC simulator

The simulator answers a Modbus transaction in 4 ms, which is optimistic — real
PLCs are often 5–15 ms, and every number below gets worse for the current code
at that end and stays flat for the patched code.

| | current | patched |
|---|---|---|
| `/api/status`, one client | 90.4 ms | 1.8 ms |
| `/api/status`, keep-alive | 89.5 ms | **0.22 ms** |
| 4 tabs + 10 Hz CSV logging, median | 151.6 ms | **0.8 ms** |
| 4 tabs + 10 Hz CSV logging, p95 | 380.0 ms | **1.7 ms** |
| PLC transactions/sec, same load | 228/sec | **30/sec, flat** |
| HMI update rate | 3.3 Hz polled | **30 Hz pushed** |

The p95 of 380 ms is the number that matches what you're feeling. You jog, and
the position on screen is a third of a second behind the machine.

## Why it was slow

**`/api/status` cost 21 Modbus round trips.** `axis_status()` issues seven
transactions per axis — enable, jog forward, jog back, then two-register reads
for velocity, accel, decel and position — and it does that three times. Every one
is a separate request/response over TCP behind a single global lock.

Every register it wants lives in **1000–1063**. Your Y and Z axes are already
contiguous, X's velocity and accel sit down at 1000–1007, and the enable register
at 1010 falls in the same span. One 64-register read replaces all 21. The patch
computes that span from your `AXES` table rather than hardcoding it, and falls
back to the old path if it ever exceeds the 125-register Modbus limit.

**Everything polled the PLC independently.** The HMI at 3.3 Hz, the CSV logger at
10 Hz, and `_wait_axis` at 20 Hz during every move all queued on the same lock.
At 4 tabs plus logging that's 228 transactions/sec — 912 ms of Modbus work per
second of wall clock. Oversubscribed, so requests just queued, which is exactly
where the 380 ms tail came from.

Now one background thread does the block read at 30 Hz and everything else reads
from RAM. The PLC sees a flat 30 transactions/sec whether one person or six have
the page open.

**HTTP/1.0.** `BaseHTTPRequestHandler` defaults to HTTP/1.0, so the connection
closed after every response and each 300 ms poll paid a fresh TCP handshake.
Now HTTP/1.1 with keep-alive. Every response path in your file already sets
`Content-Length`, including the 401, so this was safe to switch.

**Nagle's algorithm.** Small request/response pairs like Modbus hit the classic
Nagle-plus-delayed-ACK interaction, which can add up to 40 ms. `TCP_NODELAY` is
now set on both the Modbus socket and the HMI connections.

**Polling instead of pushing.** The HMI now opens `/api/live` once and gets
server-sent events at 30 Hz. Verified at 30.8 Hz with a 33.5 ms median gap. If
the stream can't be held open it falls back to the old 300 ms poll on its own,
so a proxy or a flaky link degrades instead of breaking.

## Safety

Nothing in the motion path changed — no register write, no tool-change logic, no
zone check is touched. It's all read path and transport.

The one place that needed care is `_wait_axis`, which decides that an axis has
arrived. Reading a cached position there could, if the poller thread died, look
like an axis sitting exactly on target forever. So `cached_pos()` raises when the
cache is older than 0.5 s rather than returning stale data, and `axis_status()`
reports `stale` past 1 s.

Tested by killing the PLC mid-run: all three axes go to `off`, the HMI shows
*PLC offline*, and it recovers by itself when the PLC comes back.

## Arduino

Your sketch sends every 5000 ms. For watching a value while you turn something,
that's the slowest link in the chain. The included sketch drops it to **250 ms**
and averages the ADC over 4 samples, since at 4 Hz you start seeing noise the 5 s
interval was hiding.

**This is why the patch also throttles sensor disk writes.** `ingest_sensors()`
rewrote `gantry_monitor.json` and re-ran `makedirs` plus an `exists` check on
every single reading. Harmless at 0.2 Hz, punishing at 4 Hz on an SD card. The
CSV history still gets every row; only the JSON snapshot is throttled to 1 Hz.
Verified: 12 readings at 4 Hz produced 12 history rows.

Don't push much below 250 ms — that's already ~14k CSV rows an hour.

`temperature`, `humidity` and `pressure_hpa` are still the placeholder constants
from your original sketch. The DHT and BMP280 blocks are in there commented out
and ready. Until they're fitted, 22.5 / 60 / 1013.25 on the HMI means "not
wired", not data.

## Tuning

`poll_hz` in `gantry_config.json`, default 30:

```json
{"plc_ip": "192.168.1.88", "plc_port": 502, "unit_id": 1,
 "http_port": 8091, "enable_reg": 1010, "move_mode": "absolute",
 "poll_hz": 30}
```

30 Hz is 30 transactions/sec, which is nothing for a PLC that was handling 228.
Push it to 50 if you want smoother position tracking during fast moves. Drop it
to 10 if you ever see the PLC's own scan time suffer — but at one transaction per
cycle you have a lot of headroom now.

## If the patch refuses to apply

It prints which anchors didn't match and writes nothing. That means your
`gantry_studio.py` has moved on from the copy in the handoff. Send me the current
file and I'll re-target it.
