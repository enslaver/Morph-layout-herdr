# Prints this machine's load as JSON: {"cpu", "mem", "battery", "charging", "load"} (percentages).
# Works on macOS, Windows and Linux with the standard library only.
import json, os, re, subprocess, sys, time

def run(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return ""

cpu = mem = 0.0
battery = None
charging = False

if sys.platform == "darwin":
    ncpu = os.cpu_count() or 1
    cpu = sum(float(x) for x in run("ps", "-A", "-o", "%cpu=").split() if x.replace(".", "", 1).isdigit()) / ncpu
    vm = run("vm_stat")
    page = int(re.search(r"page size of (\d+)", vm).group(1)) if "page size" in vm else 16384
    def pages(label):
        m = re.search(label + r":\s+(\d+)", vm)
        return int(m.group(1)) if m else 0
    used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page
    total = int(run("sysctl", "-n", "hw.memsize").strip() or 1)
    mem = 100 * used / total
    batt = run("pmset", "-g", "batt")
    m = re.search(r"(\d+)%;\s*([a-z ]+);", batt)
    battery = int(m.group(1)) if m else None
    charging = bool(m and ("charging" in m.group(2) and "discharging" not in m.group(2)) or "AC Power" in batt)

elif sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    class FILETIME(ctypes.Structure):
        _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]

    def times():
        i, k, u = FILETIME(), FILETIME(), FILETIME()
        ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(i), ctypes.byref(k), ctypes.byref(u))
        v = lambda f: (f.hi << 32) | f.lo
        return v(i), v(k) + v(u)  # (idle, total): kernel time already includes idle

    i1, t1 = times()
    time.sleep(0.25)
    i2, t2 = times()
    cpu = 100 * (1 - (i2 - i1) / (t2 - t1)) if t2 > t1 else 0.0

    class MEM(ctypes.Structure):
        _fields_ = [("len", wintypes.DWORD), ("load", wintypes.DWORD), ("total", ctypes.c_ulonglong),
                    ("avail", ctypes.c_ulonglong), ("tpf", ctypes.c_ulonglong), ("apf", ctypes.c_ulonglong),
                    ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("ave", ctypes.c_ulonglong)]
    ms = MEM()
    ms.len = ctypes.sizeof(MEM)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms))
    mem = float(ms.load)

    class POWER(ctypes.Structure):
        _fields_ = [("ac", ctypes.c_ubyte), ("flag", ctypes.c_ubyte), ("pct", ctypes.c_ubyte),
                    ("saver", ctypes.c_ubyte), ("life", wintypes.DWORD), ("full", wintypes.DWORD)]
    ps = POWER()
    if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(ps)) and ps.pct <= 100 and ps.flag != 128:
        battery = int(ps.pct)  # 255 = unknown, 128 = no battery
        charging = bool(ps.ac == 1)

else:  # Linux and other Unix
    def cpu_times():
        f = open("/proc/stat").readline().split()[1:]
        v = [int(x) for x in f]
        return v[3] + v[4], sum(v)
    try:
        i1, t1 = cpu_times()
        time.sleep(0.25)
        i2, t2 = cpu_times()
        cpu = 100 * (1 - (i2 - i1) / (t2 - t1)) if t2 > t1 else 0.0
        info = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo")}
        mem = 100 * (1 - info["MemAvailable"] / info["MemTotal"])
    except Exception:
        pass
    try:
        base = "/sys/class/power_supply/BAT0"
        battery = int(open(base + "/capacity").read())
        charging = open(base + "/status").read().strip() == "Charging"
    except Exception:
        pass

try:
    load = round(os.getloadavg()[0], 2)
except (AttributeError, OSError):
    load = 0

print(json.dumps({
    "cpu": round(min(100, max(0, cpu)), 1),
    "mem": round(min(100, max(0, mem)), 1),
    "battery": battery,
    "charging": charging,
    "load": load,
}))
