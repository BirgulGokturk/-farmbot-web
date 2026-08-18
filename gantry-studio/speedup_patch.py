#!/usr/bin/env python3
"""
speedup_patch.py — makes Gantry Studio fast on the LAN.

Applies six surgical edits to gantry_studio.py. Every anchor is checked before
anything is written, so it either applies cleanly or changes nothing at all.
A timestamped .bak is kept next to the original.

    python3 speedup_patch.py                      # patch ./gantry_studio.py
    python3 speedup_patch.py --file ~/gantry_pi/gantry_studio.py
    python3 speedup_patch.py --revert              # restore the newest .bak

What it changes and why:

  1. ONE BLOCK READ instead of 21.  /api/status currently issues 7 Modbus
     transactions per axis. All the registers it wants live in 1000..1063, so
     one read of 64 registers replaces all 21.
  2. BACKGROUND POLLER + CACHE.  A thread does that block read at 30 Hz into
     memory. /api/status, the CSV logger and _wait_axis then serve from RAM, so
     the PLC sees a constant 30 transactions/sec no matter how many browsers,
     tabs, or log runs are going.
  3. TCP_NODELAY on the Modbus socket.  Nagle's algorithm plus delayed ACK adds
     up to 40 ms to small request/response pairs like Modbus.
  4. HTTP/1.1 KEEP-ALIVE + NODELAY.  BaseHTTPRequestHandler defaults to
     HTTP/1.0, so every single poll paid a fresh TCP handshake.
  5. /api/live SERVER-SENT EVENTS.  The HMI stops polling every 300 ms and gets
     pushed at 30 Hz instead. This is what makes jogging feel direct.
  6. CACHED PHOTO LISTING so /api/monitor can be polled at 1 s without doing a
     directory walk every time.
  7. THROTTLED SENSOR DISK WRITES.  ingest_sensors() rewrites gantry_monitor.json
     and re-runs makedirs/exists on every single reading. That's harmless at the
     Arduino's current 5 s interval and punishing at 250 ms. The CSV history
     still gets every row; only the JSON snapshot is throttled to 1 Hz.

Nothing here changes motion logic, the tool-change sequence, or any register
write. It is all read-path and transport.
"""

import argparse
import glob
import os
import shutil
import sys
import time

# --------------------------------------------------------------- new code


CACHE_BLOCK = '''
# ---- fast register cache -------------------------------------------------
# /api/status used to cost 21 Modbus transactions (7 per axis). Every register
# it needs sits in one contiguous span, so a single block read replaces all of
# them, and a background thread keeps it warm. Readers never touch the PLC.
POLL_HZ = float(CONFIG.get("poll_hz", 30))
_need = [R_ENABLE]
for _m in AXES:
    _need += [_m["jogf"], _m["jogb"]]
    for _k in ("vel", "accel", "decel", "pos"):
        _need += [_m[_k], _m[_k] + 1]
BLK_LO = min(_need)
BLK_N = max(_need) - BLK_LO + 1
BLK_OK = BLK_N <= 125          # Modbus caps a single read at 125 registers
CACHE = {"regs": None, "t": 0.0, "err": "starting", "reads": 0, "fails": 0}
_CLOCK = threading.Lock()

def cache_snapshot():
    with _CLOCK:
        return CACHE["regs"], CACHE["t"], CACHE["err"]

def cache_age():
    with _CLOCK:
        return time.time() - CACHE["t"] if CACHE["regs"] is not None else 1e9

def _u16(regs, addr):
    return regs[addr - BLK_LO]

def _f32(regs, addr):
    i = addr - BLK_LO
    return struct.unpack(">f", struct.pack(">I", (regs[i + 1] << 16) | regs[i]))[0]

def cached_pos(i):
    """Position in raw counts from the cache. Raises if the data is stale, so a
    dead poller can never look like an axis that has arrived at its target."""
    regs, t, err = cache_snapshot()
    if regs is None:
        raise IOError(err or "no PLC data")
    if time.time() - t > 0.5:
        raise IOError("stale PLC data (%.1fs)" % (time.time() - t))
    return _f32(regs, AXES[i]["pos"])

def _poll_worker():
    period = 1.0 / max(1.0, POLL_HZ)
    while True:
        t0 = time.time()
        try:
            regs = mb.read(BLK_LO, BLK_N)
            with _CLOCK:
                CACHE["regs"] = regs; CACHE["t"] = time.time()
                CACHE["err"] = ""; CACHE["reads"] += 1
        except Exception as e:
            with _CLOCK:
                CACHE["regs"] = None; CACHE["err"] = str(e); CACHE["fails"] += 1
            time.sleep(0.25)
        time.sleep(max(0.0, period - (time.time() - t0)))

if BLK_OK:
    threading.Thread(target=_poll_worker, daemon=True, name="plcpoll").start()
else:
    print("register span %d too wide for one read - falling back to per-register polling" % BLK_N)
'''


AXIS_STATUS_NEW = '''def axis_status(i):
    m=AXES[i]
    if not BLK_OK:
        try:
            return {"en":mb.read(R_ENABLE,1)[0],"jf":mb.read(m["jogf"],1)[0],"jb":mb.read(m["jogb"],1)[0],
                    "vel":rf(m["vel"]),"accel":rf(m["accel"]),"decel":rf(m["decel"]),"pos":rf(m["pos"])}
        except Exception as e:
            return {"err":str(e)}
    regs,t,err=cache_snapshot()
    if regs is None: return {"err":err or "no PLC data"}
    if time.time()-t>1.0: return {"err":"stale (%.1fs)"%(time.time()-t)}
    return {"en":_u16(regs,R_ENABLE),"jf":_u16(regs,m["jogf"]),"jb":_u16(regs,m["jogb"]),
            "vel":_f32(regs,m["vel"]),"accel":_f32(regs,m["accel"]),
            "decel":_f32(regs,m["decel"]),"pos":_f32(regs,m["pos"])}
'''


WAIT_AXIS_NEW = '''def _wait_axis(i,tgt,tol=0.6,timeout=45.0):
    t0=time.time()
    while time.time()-t0<timeout:
        try:
            raw=cached_pos(i) if BLK_OK else rf(AXES[i]["pos"])
            if abs(mm_from_raw(i,raw)-tgt)<=tol: return True
        except Exception: pass
        time.sleep(0.02)
    return False
'''


LOG_ROW_NEW = '''def _log_row():
    raws=[]; mms=[]; en=0
    if BLK_OK:
        regs,t,err=cache_snapshot()
        for i in range(N):
            try: r=_f32(regs,AXES[i]["pos"]) if regs is not None else 0.0
            except Exception: r=0.0
            raws.append(round(r,3)); mms.append(round(mm_from_raw(i,r),4))
        try: en=_u16(regs,R_ENABLE) if regs is not None else 0
        except Exception: en=0
    else:
        for i in range(N):
            try: r=rf(AXES[i]["pos"])
            except Exception: r=0.0
            raws.append(round(r,3)); mms.append(round(mm_from_raw(i,r),4))
        try: en=mb.read(R_ENABLE,1)[0]
        except Exception: en=0
    t=time.time()
    return ([time.strftime("%Y-%m-%dT%H:%M:%S",time.localtime())+(".%03d"%int((t%1)*1000)),
             round(t-LOG.get("t0",t),3)]+mms+raws+[en,'"%s"'%str(LOG.get("event","")).replace('"',"'")])
'''


INGEST_SENSORS_NEW = '''_MON_IO={"save":0.0,"hdr":False}
def ingest_sensors(d):
    # RAM is updated on every reading; the disk is not. At a 250 ms Arduino
    # interval the old version did a JSON rewrite plus makedirs plus an exists
    # check four times a second, which is real wear on an SD card.
    MON["sensors"]=dict(d); MON["sensors_time"]=_iso()
    now=time.time()
    if now-_MON_IO["save"]>=1.0:
        _MON_IO["save"]=now; _mon_save()
    try:
        if not _MON_IO["hdr"]:
            os.makedirs(os.path.dirname(MON_HIST),exist_ok=True)
            _MON_IO["hdr"]=os.path.exists(MON_HIST)
            if not _MON_IO["hdr"]:
                with open(MON_HIST,"a",newline="") as f:
                    f.write("t_iso,"+",".join(sorted(d.keys()))+"\\n")
                _MON_IO["hdr"]=True
        keys=sorted(d.keys())
        with open(MON_HIST,"a",newline="") as f:
            f.write(MON["sensors_time"]+","+",".join(str(d.get(k,"")) for k in keys)+"\\n")
    except Exception: pass
'''


STATUS_PAYLOAD = '''
# ---- one place that builds the status object, used by /api/status and /api/live ----
def status_payload():
    out=[]; ok=True
    for i in range(N):
        st=axis_status(i)
        if st.get("err"): ok=False; out.append({"off":True})
        else: out.append(st)
    return {"ok":ok,"axes":out,"current_tool":TOOLS.get("current_tool"),
            "presence":read_presence(),"prog":PROG,"t":time.time()}

# ---- photo listing cache: /api/monitor gets polled every second now, and a
# directory walk per request would dominate it once there are a few hundred photos.
_PHOTO_CACHE={"list":None,"t":0.0}
def list_photos_cached(ttl=4.0):
    now=time.time()
    if _PHOTO_CACHE["list"] is None or now-_PHOTO_CACHE["t"]>ttl:
        _PHOTO_CACHE["list"]=list_photos(); _PHOTO_CACHE["t"]=now
    return _PHOTO_CACHE["list"]
'''


SSE_HANDLER = '''        if s.path.startswith("/api/live"):
            # Server-sent events: the HMI opens this once and gets pushed at
            # POLL_HZ instead of asking every 300 ms over a fresh connection.
            try:
                s.send_response(200)
                s.send_header("Content-Type","text/event-stream")
                s.send_header("Cache-Control","no-cache")
                s.send_header("X-Accel-Buffering","no")
                s.send_header("Connection","close")
                s.end_headers()
                s.close_connection=True
                period=1.0/max(1.0,POLL_HZ); last_mon=0.0; last_ping=time.time()
                while True:
                    t0=time.time()
                    frame="data: "+json.dumps(status_payload())+"\\n\\n"
                    if t0-last_mon>1.0:
                        last_mon=t0
                        frame+="event: mon\\ndata: "+json.dumps({
                            "sensors":MON["sensors"],"sensors_time":MON["sensors_time"],
                            "status":MON["status"],"status_time":MON["status_time"]})+"\\n\\n"
                    if t0-last_ping>15.0:
                        last_ping=t0; frame+=": ping\\n\\n"
                    s.wfile.write(frame.encode()); s.wfile.flush()
                    time.sleep(max(0.0,period-(time.time()-t0)))
            except Exception:
                pass
            return
'''


HMI_JS_NEW = r'''// ---- poll / live push ----
function applyStatus(s){try{const ok=s.ok!==false;
 $('dot').className='dot'+(ok?' ok':'');$('conntxt').textContent=ok?'PLC connected':'PLC offline';
 if(s.axes){for(let i=0;i<N;i++){const d=s.axes[i]||{};if(d.pos!=null)ax[i].pos=d.pos;ax[i].en=!!d.en;ax[i].jf=d.jf;ax[i].jb=d.jb;
  if($('ccur'+i))$('ccur'+i).textContent=mmOf(i).toFixed(2);}
  enabled=!!(s.axes[0]&&s.axes[0].en);}
 if(s.prog&&$('progstat')){const p=s.prog;
  $('progstat').textContent=p.on?('● running "'+p.name+'" — loop '+p.loops_done+(p.loop?('/'+p.loop):' (∞)')+', step '+p.step+'/'+p.nsteps+(p.cur?(' → '+p.cur):'')):
   (p.error?('stopped: '+p.error):(p.loops_done?('done — '+p.loops_done+' loop(s)'):'idle'));}
 if('current_tool' in s){TOOLS.current_tool=s.current_tool;if($('curtool'))$('curtool').textContent=s.current_tool||'none';}
 if('presence' in s&&$('presind')){const p=s.presence;$('presind').textContent=(p===null)?'not wired':(p?'TOOL PRESENT':'empty');
  $('presind').style.color=p?'#33d17a':(p===false?'#f5b13d':'#8b9bb4');}
 paint();}catch(e){}}
async function poll(){try{const r=await fetch('/api/status');applyStatus(await r.json());}
 catch(e){$('dot').className='dot';$('conntxt').textContent='no bridge';}}
// Live push, with polling kept as the fallback if the stream can't be held open.
let _es=null,_fallback=null;
function startLive(){
 try{ _es=new EventSource('/api/live'); }catch(e){ _fallback=setInterval(poll,300); return; }
 _es.onmessage=e=>{ if(_fallback){clearInterval(_fallback);_fallback=null;} applyStatus(JSON.parse(e.data)); };
 _es.addEventListener('mon',e=>{ try{ renderMonitor(JSON.parse(e.data)); }catch(_){} });
 _es.onerror=()=>{ if(!_fallback) _fallback=setInterval(poll,300); };
}
loadCal();loadStore();loadTools();loadMove();poll();startLive();setInterval(logRef,1000);logRef();
'''


# --------------------------------------------------------------- edits


def build_edits():
    """(description, old, new, count) — count is how many matches are expected."""
    return [
        (
            "Modbus socket: disable Nagle",
            's.sock=socket.create_connection((s.ip,s.port),timeout=1.5); s.sock.settimeout(1.5)',
            's.sock=socket.create_connection((s.ip,s.port),timeout=1.5); s.sock.settimeout(1.5)\n'
            '                        s.sock.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)',
            1,
        ),
        (
            "register cache + 30 Hz background poller",
            "# ---- tool change (passive latch) : all XY travel at safe Z, zone-checked ----",
            CACHE_BLOCK.strip()
            + "\n\n# ---- tool change (passive latch) : all XY travel at safe Z, zone-checked ----",
            1,
        ),
        (
            "axis_status() reads the cache instead of 7 transactions",
            'def axis_status(i):\n'
            '    m=AXES[i]\n'
            '    try:\n'
            '        return {"en":mb.read(R_ENABLE,1)[0],"jf":mb.read(m["jogf"],1)[0],"jb":mb.read(m["jogb"],1)[0],\n'
            '                "vel":rf(m["vel"]),"accel":rf(m["accel"]),"decel":rf(m["decel"]),"pos":rf(m["pos"])}\n'
            '    except Exception as e:\n'
            '        return {"err":str(e)}\n',
            AXIS_STATUS_NEW,
            1,
        ),
        (
            "_wait_axis() uses the cache, with a staleness guard",
            'def _wait_axis(i,tgt,tol=0.6,timeout=45.0):\n'
            '    t0=time.time()\n'
            '    while time.time()-t0<timeout:\n'
            '        try:\n'
            '            if abs(mm_from_raw(i,rf(AXES[i]["pos"]))-tgt)<=tol: return True\n'
            '        except Exception: pass\n'
            '        time.sleep(0.05)\n'
            '    return False\n',
            WAIT_AXIS_NEW,
            1,
        ),
        (
            "CSV logger reads the cache (was 7 transactions per row)",
            'def _log_row():\n'
            '    raws=[]; mms=[]\n'
            '    for i in range(N):\n'
            '        try: r=rf(AXES[i]["pos"])\n'
            '        except Exception: r=0.0\n'
            '        raws.append(round(r,3)); mms.append(round(mm_from_raw(i,r),4))\n'
            '    try: en=mb.read(R_ENABLE,1)[0]\n'
            '    except Exception: en=0\n'
            '    t=time.time()\n'
            '    return ([time.strftime("%Y-%m-%dT%H:%M:%S",time.localtime())+(".%03d"%int((t%1)*1000)),\n'
            '             round(t-LOG.get("t0",t),3)]+mms+raws+[en,\'"%s"\'%str(LOG.get("event","")).replace(\'"\',"\'")])\n',
            LOG_ROW_NEW,
            1,
        ),
        (
            "sensor ingest: throttle disk writes for a faster Arduino",
            'def ingest_sensors(d):\n'
            '    MON["sensors"]=dict(d); MON["sensors_time"]=_iso(); _mon_save()\n'
            '    try:\n'
            '        os.makedirs(os.path.dirname(MON_HIST),exist_ok=True)\n'
            '        keys=sorted(d.keys()); new=not os.path.exists(MON_HIST)\n'
            '        with open(MON_HIST,"a",newline="") as f:\n'
            '            if new: f.write("t_iso,"+",".join(keys)+"\\n")\n'
            '            f.write(MON["sensors_time"]+","+",".join(str(d.get(k,"")) for k in keys)+"\\n")\n'
            '    except Exception: pass\n',
            INGEST_SENSORS_NEW,
            1,
        ),
        (
            "shared status builder + photo-list cache",
            "# ================= HMI PAGE =================",
            STATUS_PAYLOAD.strip() + "\n\n# ================= HMI PAGE =================",
            1,
        ),
        (
            "HTTP/1.1 keep-alive + NODELAY on the HMI socket",
            '    def _auth_ok(s):',
            '    protocol_version="HTTP/1.1"          # keep-alive: no TCP handshake per poll\n'
            '    def setup(s):\n'
            '        BaseHTTPRequestHandler.setup(s)\n'
            '        try: s.connection.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)\n'
            '        except Exception: pass\n'
            '    def _auth_ok(s):',
            1,
        ),
        (
            "/api/status uses the shared builder",
            '        if s.path.startswith("/api/status"):\n'
            '            out=[]; ok=True\n'
            '            for i in range(N):\n'
            '                st=axis_status(i)\n'
            '                if st.get("err"): ok=False; out.append({"off":True})\n'
            '                else: out.append(st)\n'
            '            s._send(200,json.dumps({"ok":ok,"axes":out,\n'
            '                "current_tool":TOOLS.get("current_tool"),"presence":read_presence(),"prog":PROG})); return\n',
            '        if s.path.startswith("/api/status"):\n'
            '            s._send(200,json.dumps(status_payload())); return\n'
            + SSE_HANDLER,
            1,
        ),
        (
            "/api/monitor uses the cached photo listing",
            '"status":MON["status"],"status_time":MON["status_time"],"photos":list_photos()}))',
            '"status":MON["status"],"status_time":MON["status_time"],"photos":list_photos_cached()}))',
            1,
        ),
        (
            "HMI: live push instead of a 300 ms poll",
            "// ---- poll ----",
            "// ---- poll ----@@MARK@@",
            1,
        ),
    ]


def patch_hmi_js(text):
    """Replace the poll() function and the boot line with the live-push version."""
    start = text.index("// ---- poll ----@@MARK@@")
    end_anchor = "loadCal();loadStore();loadTools();loadMove();setInterval(poll,300);poll();setInterval(logRef,1000);logRef();"
    end = text.index(end_anchor) + len(end_anchor)
    return text[:start] + HMI_JS_NEW.rstrip("\n") + text[end:]


def patch_monitor_render(text):
    """
    Split loadMonitor() into a fetch and a renderMonitor(j), so the SSE 'mon'
    event can paint sensors without a request.
    """
    old = "async function loadMonitor(){try{const r=await fetch('/api/monitor');const j=await r.json();"
    new = ("async function loadMonitor(){try{const r=await fetch('/api/monitor');const j=await r.json();"
           "renderMonitor(j);}catch(e){}}\n"
           "function renderMonitor(j){try{")
    if old not in text:
        return text, False
    return text.replace(old, new, 1), True


# --------------------------------------------------------------- driver


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="gantry_studio.py")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    path = os.path.abspath(args.file)

    if args.revert:
        baks = sorted(glob.glob(path + ".bak.*"))
        if not baks:
            print("no backup found next to", path)
            return 1
        shutil.copy2(baks[-1], path)
        print("restored from", os.path.basename(baks[-1]))
        return 0

    if not os.path.exists(path):
        print("not found:", path)
        return 1

    with open(path, encoding="utf-8") as f:
        text = f.read()

    if "POLL_HZ" in text and "/api/live" in text:
        print("already patched — nothing to do")
        return 0

    # Check every anchor first; apply nothing unless all of them match.
    edits = build_edits()
    problems = []
    for desc, old, _new, want in edits:
        got = text.count(old)
        if got != want:
            problems.append(f"  [{got} matches, expected {want}]  {desc}")
    if problems:
        print("aborting — the file does not look like the expected version:")
        print("\n".join(problems))
        print("\nNothing was written. Send me your gantry_studio.py and I'll re-target the patch.")
        return 2

    for desc, old, new, _want in edits:
        text = text.replace(old, new, 1)
        print("  applied:", desc)

    text = patch_hmi_js(text)
    print("  applied: HMI poll() -> applyStatus() + EventSource")

    text, ok = patch_monitor_render(text)
    print("  applied: loadMonitor() split for push updates"
          if ok else "  skipped: loadMonitor() not found (sensors will still poll)")

    compile(text, path, "exec")   # refuse to write anything that won't import

    if args.dry_run:
        print("\ndry run — nothing written")
        return 0

    bak = path + ".bak." + time.strftime("%Y%m%d_%H%M%S")
    shutil.copy2(path, bak)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"\npatched {path}")
    print(f"backup  {bak}")
    print("\nrestart:  sudo systemctl restart gantry-studio")
    print("revert:   python3 speedup_patch.py --revert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
