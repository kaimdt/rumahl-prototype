#!/usr/bin/env python3
"""iora-setup-gui -- graphical first-boot setup screen on the local display.

Renders the IORA first-boot status as a full-screen GUI directly on the
Linux framebuffer (/dev/fb0), so devices with an attached display (HDMI)
show a branded, graphical screen instead of the text TUI. It polls the
same ``setup-state.json`` the console TUI uses, so both views always
agree. A systemd wrapper picks the GUI when a framebuffer exists and
falls back to the TUI otherwise.

The drawing core is backend-agnostic: the framebuffer is one backend,
and ``--ppm`` renders a single frame to a PPM file (used for local
verification and development without a framebuffer).

Usage on device (via iora-setup-display.service):
    python3 /usr/lib/iora/iora-setup-gui.py

Development / verification:
    python3 iora-setup-gui.py --ppm out.ppm [--size 1920x1080]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import socket
import struct
import subprocess
import sys
import time

from iora_qr import qr_matrix  # local QR encoder (verified against jsQR)

try:
    import fcntl  # Linux only
    import mmap    # Linux only
except ImportError:  # pragma: no cover - macOS dev fallback
    fcntl = None
    mmap = None

# ── Paths / flags (same contract as iora-setup-tui) ──────────────────────────
STATE_FILE = "/mnt/data/iora/setup-state.json"
SETUP_DONE_FLAG = "/mnt/data/iora/.setup-complete"
SETUP_DONE_FLAG_ROOTFS = "/etc/iora/.setup-complete"
SETUP_PORT = 8080
DASHBOARD_PORT = 8126

NO_IP_PROMPT_AFTER = 30
STALE_RUN_WARN_SECONDS = 300
STUCK_PERCENT_WARN_SECONDS = 180

# ── IORA palette (matches the web UI design tokens) ───────────────────────────
NAVY_TOP = (0x0A, 0x0C, 0x12)
NAVY_BOTTOM = (0x0E, 0x16, 0x26)
SURFACE = (0x16, 0x18, 0x1F)
SURFACE_BORDER = (0x2A, 0x2E, 0x3A)
ACCENT = (0x25, 0x63, 0xEB)        # --primary
ACCENT_LIGHT = (0x3B, 0x82, 0xF6)  # --primary-light
CYAN = (0x22, 0xD3, 0xEE)
TEXT = (0xE5, 0xE7, 0xEB)
TEXT_DIM = (0x9C, 0xA3, 0xAF)
TEXT_FAINT = (0x6B, 0x72, 0x80)
GREEN = (0x22, 0xC5, 0x5E)
RED = (0xEF, 0x44, 0x44)
YELLOW = (0xF5, 0x9E, 0x0B)
LOG_BG = (0x0E, 0x0E, 0x0E)
LOG_ERR = (0xFC, 0xA5, 0xA5)

# Brand mark geometry (from frontend/public/iora-icon.svg, 512x512 viewBox).
LOGO_SIZE = 512
HEXAGON = [(256, 74), (104, 166), (104, 346), (256, 438), (408, 346), (408, 166)]
ROOF = [(174, 274), (174, 366), (338, 366), (338, 274), (256, 206), (174, 274)]
DOT = (256, 306, 22)  # cx, cy, r

# ── Embedded 8x8 bitmap font (generated from a monospace face) ────────────────
FONT = {" ":[0,0,0,0,0,0,0,0],"!":[0,8,8,8,8,0,24,0],"\"":[0,44,44,0,0,0,0,0],"#":[0,20,28,28,60,60,40,0],"$":[0,8,60,56,28,12,60,8],"%":[0,48,48,60,60,12,12,0],"&":[0,24,48,48,60,44,60,0],"'":[0,24,24,0,0,0,0,0],"(":[8,8,16,16,16,16,8,8],")":[16,16,8,8,8,8,16,16],"*":[0,0,0,60,24,60,0,0],"+":[0,0,0,8,60,8,0,0],",":[0,0,0,0,0,0,24,16],"-":[0,0,0,0,60,0,0,0],".":[0,0,0,0,0,16,24,0],"/":[0,4,8,8,16,16,48,32],"0":[0,24,44,44,52,52,24,0],"1":[0,24,24,8,8,8,28,0],"2":[0,56,4,12,8,16,60,0],"3":[0,56,4,24,12,4,60,0],"4":[0,8,24,24,44,60,8,0],"5":[0,56,32,56,12,4,56,0],"6":[0,28,32,56,36,36,28,0],"7":[0,60,12,8,8,24,16,0],"8":[0,28,36,28,60,36,60,0],"9":[0,56,36,36,60,4,56,0],":":[0,0,0,24,0,0,24,0],";":[0,0,0,24,0,0,24,16],"<":[0,0,0,28,48,28,0,0],"=":[0,0,0,60,0,60,0,0],">":[0,0,0,56,12,56,0,0],"?":[0,28,4,8,24,0,24,0],"@":[0,24,52,44,52,52,44,28],"A":[0,24,24,24,60,60,36,0],"B":[0,60,36,60,36,36,60,0],"C":[0,28,48,32,32,32,28,0],"D":[0,56,36,36,36,36,56,0],"E":[0,60,32,60,48,32,60,0],"F":[0,60,48,60,48,48,48,0],"G":[0,28,32,32,44,36,28,0],"H":[0,36,36,60,36,36,36,0],"I":[0,60,24,24,24,24,60,0],"J":[0,28,12,12,12,12,56,0],"K":[0,36,40,56,56,44,36,0],"L":[0,32,32,32,32,32,60,0],"M":[0,44,44,60,52,36,36,0],"N":[0,100,116,116,124,108,108,0],"O":[0,24,36,36,36,36,28,0],"P":[0,60,36,36,56,32,32,0],"Q":[0,24,36,36,36,36,28,12],"R":[0,56,36,44,56,36,36,0],"S":[0,60,32,48,12,4,60,0],"T":[0,60,24,24,24,24,24,0],"U":[0,36,36,36,36,36,60,0],"V":[0,36,36,52,24,24,24,0],"W":[0,102,36,60,60,60,52,0],"X":[0,36,28,24,24,60,36,0],"Y":[0,36,60,24,24,24,24,0],"Z":[0,60,12,8,16,16,60,0],"[":[8,8,8,8,8,8,8,8],"\\":[0,32,48,16,24,8,12,4],"]":[16,24,8,8,8,8,8,16],"^":[0,24,60,36,0,0,0,0],"_":[0,0,0,0,0,0,0,60],"`":[16,16,0,0,0,0,0,0],"a":[0,0,24,12,28,36,60,0],"b":[0,32,56,60,36,36,60,0],"c":[0,0,8,20,32,48,28,0],"d":[0,4,28,60,36,36,60,0],"e":[0,0,24,60,60,32,28,0],"f":[0,12,24,24,16,16,16,0],"g":[0,0,16,60,36,36,28,12],"h":[0,32,56,60,36,36,36,0],"i":[0,8,16,24,8,8,28,0],"j":[0,8,16,24,8,8,8,8],"k":[0,48,52,56,56,56,52,0],"l":[0,24,24,24,24,8,12,0],"m":[0,0,48,60,44,44,44,0],"n":[0,0,8,60,36,36,36,0],"o":[0,0,24,60,36,36,28,0],"p":[0,0,8,60,36,36,60,32],"q":[0,0,16,60,36,36,60,4],"r":[0,0,4,24,16,16,16,0],"s":[0,0,24,48,24,12,56,0],"t":[0,16,56,16,16,16,28,0],"u":[0,0,0,36,36,36,60,0],"v":[0,0,32,36,60,24,24,0],"w":[0,0,0,36,60,60,60,0],"x":[0,0,36,60,24,24,36,0],"y":[0,0,32,36,28,24,24,16],"z":[0,0,24,12,8,16,60,0],"{":[12,8,8,24,48,8,8,12],"|":[0,8,8,8,8,8,8,8],"}":[48,24,24,8,12,24,24,48],"~":[0,0,0,48,60,12,0,0]}

_GLYPH_W = 8
_GLYPH_H = 8


def text_width(text: str, scale: int) -> int:
    return len(text) * _GLYPH_W * scale


# ── State helpers (identical contract to iora-setup-tui) ──────────────────────
def get_primary_ip() -> str:
    try:
        out = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", "scope", "global"],
            capture_output=True, text=True, timeout=2,
        ).stdout
        for line in out.splitlines():
            parts = line.split()
            for i, p in enumerate(parts):
                if p == "inet" and i + 1 < len(parts):
                    return parts[i + 1].split("/")[0]
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ""


def load_state() -> dict | None:
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None


def setup_done() -> bool:
    return os.path.exists(SETUP_DONE_FLAG) or os.path.exists(SETUP_DONE_FLAG_ROOTFS)


def state_change_key(state: dict | None, ip: str) -> str:
    """Cheap fingerprint used to skip redraws when nothing changed."""
    if not state:
        return f"ip={ip}"
    return json.dumps(
        [
            ip,
            state.get("status"),
            state.get("percent"),
            state.get("phase_label"),
            [e for e in (state.get("errors") or [])[-3:]],
            [m.get("msg", "") for m in (state.get("log") or [])[-3:]],
        ],
        sort_keys=True,
    )


# ── Geometry helpers ──────────────────────────────────────────────────────────
def point_in_polygon(x: float, y: float, poly: list) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def dist_to_polyline(px: float, py: float, poly: list) -> float:
    best = float("inf")
    for i in range(len(poly) - 1):
        d = dist_to_segment(px, py, *poly[i], *poly[i + 1])
        if d < best:
            best = d
    return best


def rounded_rect_dist(px: float, py: float, cx: float, cy: float, half_w: float, half_h: float, r: float) -> float:
    dx = max(abs(px - cx) - (half_w - r), 0.0)
    dy = max(abs(py - cy) - (half_h - r), 0.0)
    return math.hypot(dx, dy) - r


# ── Backends ──────────────────────────────────────────────────────────────────
class PpmCanvas:
    """Render to an in-memory RGB buffer and write PPM P6 (for verification)."""

    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self.buf = bytearray(width * height * 3)

    def set(self, x: int, y: int, rgb: tuple) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            i = (y * self.width + x) * 3
            self.buf[i] = rgb[0]
            self.buf[i + 1] = rgb[1]
            self.buf[i + 2] = rgb[2]

    def save(self, path: str) -> None:
        header = f"P6\n{self.width} {self.height}\n255\n".encode()
        with open(path, "wb") as f:
            f.write(header)
            f.write(bytes(self.buf))


class FramebufferCanvas:
    """Render directly to /dev/fb0 (Linux). Supports 32/24/16 bpp."""

    FBIOGET_VSCREENINFO = 0x4600

    def __init__(self, path: str = "/dev/fb0"):
        self.fd = os.open(path, os.O_RDWR)
        try:
            info = struct.pack("<20I", *([0] * 20))
            info = fcntl.ioctl(self.fd, self.FBIOGET_VSCREENINFO, info)
            fields = struct.unpack("<20I", info)
        except Exception:
            os.close(self.fd)
            raise
        self.width = fields[0]          # xres
        self.height = fields[1]         # yres
        self.stride = fields[2]         # xres_virtual
        self.bpp = fields[6]            # bits_per_pixel
        self.red_off, self.red_len = fields[8], fields[9]
        self.green_off, self.green_len = fields[12], fields[13]
        self.blue_off, self.blue_len = fields[16], fields[17]
        self.bytes_pp = max(1, self.bpp // 8)
        self.buf = mmap.mmap(self.fd, self.stride * self.height * self.bytes_pp, mmap.MAP_SHARED, mmap.PROT_READ | mmap.PROT_WRITE)

    def pack_pixel(self, r: int, g: int, b: int) -> bytes:
        """One pixel in the native framebuffer byte order (for bulk rows)."""
        if self.bpp == 32 or self.bpp == 24:
            out = bytearray(self.bytes_pp)
            out[self.blue_off // 8] = b
            out[self.green_off // 8] = g
            out[self.red_off // 8] = r
            return bytes(out)
        if self.bpp == 16:
            val = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            return bytes([val & 0xFF, (val >> 8) & 0xFF])
        return bytes([b, g, r])

    def set(self, x: int, y: int, rgb: tuple) -> None:
        if x < 0 or x >= self.width or y < 0 or y >= self.height:
            return
        r, g, b = rgb
        i = (y * self.stride + x) * self.bytes_pp
        if self.bpp == 32:
            self.buf[i + self.blue_off // 8] = b
            self.buf[i + self.green_off // 8] = g
            self.buf[i + self.red_off // 8] = r
        elif self.bpp == 24:
            self.buf[i + self.blue_off // 8] = b
            self.buf[i + self.green_off // 8] = g
            self.buf[i + self.red_off // 8] = r
        elif self.bpp == 16:
            val = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            self.buf[i] = val & 0xFF
            self.buf[i + 1] = (val >> 8) & 0xFF
        else:
            # Unknown depth — best effort BGR order.
            self.buf[i] = b
            self.buf[i + 1] = g
            self.buf[i + 2] = r

    def close(self) -> None:
        try:
            self.buf.flush()
        except Exception:
            pass
        self.buf.close()
        os.close(self.fd)


def open_canvas(args) -> tuple:
    if args.ppm:
        w, h = (int(v) for v in args.size.split("x"))
        return PpmCanvas(w, h), w, h
    fb = FramebufferCanvas()
    return fb, fb.width, fb.height


# ── Drawing primitives (backend-agnostic) ────────────────────────────────────
def fill(c, w, h, rgb):
    for y in range(h):
        for x in range(w):
            c.set(x, y, rgb)


def vertical_gradient(c, w, h, top, bottom):
    """Fill a vertical gradient, writing whole scanlines in bulk."""
    # PPM backend: 3 bytes per pixel.
    if isinstance(c, PpmCanvas):
        stride = w * 3
        for y in range(h):
            t = y / max(1, h - 1)
            col = bytes(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
            c.buf[y * stride:(y + 1) * stride] = col * w
        return
    # Framebuffer backend: bulk rows in the native fb byte order.
    if isinstance(c, FramebufferCanvas):
        stride = c.stride * c.bytes_pp
        for y in range(h):
            t = y / max(1, h - 1)
            r, g, b = (int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
            c.buf[y * stride:(y + 1) * stride] = c.pack_pixel(r, g, b) * c.stride
        return
    for y in range(h):
        t = y / max(1, h - 1)
        col = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            c.set(x, y, col)


def fill_rect(c, x, y, w, h, rgb):
    for yy in range(max(0, y), min(c.height, y + h)):
        for xx in range(max(0, x), min(c.width, x + w)):
            c.set(xx, yy, rgb)


def fill_rounded_rect(c, x, y, w, h, radius, rgb):
    for yy in range(max(0, y), min(c.height, y + h)):
        for xx in range(max(0, x), min(c.width, x + w)):
            if rounded_rect_dist(xx + 0.5, yy + 0.5, x + w / 2, y + h / 2, w / 2, h / 2, radius) <= 0:
                c.set(xx, yy, rgb)


def fill_circle(c, cx, cy, r, rgb):
    for yy in range(cy - r, cy + r + 1):
        for xx in range(cx - r, cx + r + 1):
            if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r:
                c.set(xx, yy, rgb)


def fill_polygon(c, cx0, cy0, scale, poly, rgb):
    # Rasterize via point-in-polygon over the polygon's bounding box.
    xs = [cx0 + p[0] * scale for p in poly]
    ys = [cy0 + p[1] * scale for p in poly]
    for yy in range(int(min(ys)), int(max(ys)) + 1):
        for xx in range(int(min(xs)), int(max(xs)) + 1):
            if point_in_polygon(xx + 0.5, yy + 0.5, list(zip(xs, ys))):
                c.set(xx, yy, rgb)


def stroke_polyline(c, cx0, cy0, scale, poly, width, rgb):
    # Stroke width in scaled space; convert points once.
    pts = [(cx0 + p[0] * scale, cy0 + p[1] * scale) for p in poly]
    min_x = max(0, int(min(p[0] for p in pts)) - width)
    max_x = min(c.width - 1, int(max(p[0] for p in pts)) + width)
    min_y = max(0, int(min(p[1] for p in pts)) - width)
    max_y = min(c.height - 1, int(max(p[1] for p in pts)) + width)
    half = width / 2
    for yy in range(min_y, max_y + 1):
        for xx in range(min_x, max_x + 1):
            d = dist_to_polyline(xx + 0.5, yy + 0.5, pts)
            if d <= half:
                c.set(xx, yy, rgb)


def draw_text(c, x, y, text, scale, rgb, align="left"):
    """Draw 8x8 font text; bit 7 is the leftmost pixel of each row."""
    if align == "center":
        x -= text_width(text, scale) // 2
    for col, ch in enumerate(text):
        glyph = FONT.get(ch, FONT["?"])
        base_x = x + col * 8 * scale
        for row in range(8):
            bits = glyph[row]
            for bit in range(8):
                if bits & (1 << (7 - bit)):
                    fx = base_x + bit * scale
                    fy = y + row * scale
                    for dy in range(scale):
                        for dx in range(scale):
                            c.set(fx + dx, fy + dy, rgb)


# ── Brand mark sprite (rasterized once per scale, then stamped scaled) ────────
_mark_cache: dict = {}


def build_logo_mark(scale: float) -> list:
    """Return list of (x, y, rgb) pixels of the IORA hexagon mark at `scale`."""
    cached = _mark_cache.get(scale)
    if cached is not None:
        return cached
    px = []
    r_hex = 9.0 * scale          # hexagon stroke half-width (18/2 in 512 space)
    r_roof = 11.0 * scale        # roof stroke half-width (22/2)
    for sy in range(int(LOGO_SIZE * scale)):
        y = sy / scale
        for sx in range(int(LOGO_SIZE * scale)):
            x = sx / scale
            # rounded-square background (rx 112 in 512 space)
            if rounded_rect_dist(x, y, 256, 256, 256, 256, 112 * scale) > 0:
                continue
            rgb = None
            if (x - DOT[0]) ** 2 + (y - DOT[1]) ** 2 <= (DOT[2] * scale) ** 2:
                rgb = ACCENT_LIGHT
            elif dist_to_polyline(x, y, ROOF) <= r_roof:
                rgb = TEXT
            elif dist_to_polyline(x, y, HEXAGON) <= r_hex:
                rgb = ACCENT_LIGHT
            elif point_in_polygon(x, y, HEXAGON):
                rgb = (0x18, 0x23, 0x37)
            else:
                rgb = (0x08, 0x0B, 0x10)
            px.append((sx, sy, rgb))
    _mark_cache[scale] = px
    return px


def stamp_mark(c, mark: list, cx: int, cy: int, scale: float) -> None:
    # mark was rasterized at `scale`; place so the 512-space center maps to (cx, cy).
    ox = cx - int(LOGO_SIZE * scale / 2)
    oy = cy - int(LOGO_SIZE * scale / 2)
    for x, y, rgb in mark:
        c.set(ox + x, oy + y, rgb)


# ── Screen composer ───────────────────────────────────────────────────────────
def fit_scale(text: str, scale: int, max_width: int) -> int:
    while scale > 1 and text_width(text, scale) > max_width:
        scale -= 1
    return scale


def draw_qr(c, cx, top, text, max_width, max_height):
    """Render a scannable QR code centered under the setup URL.
    Modules are drawn white-on-black with a quiet zone; the module size
    scales down automatically so the code always fits both dimensions."""
    try:
        mat = qr_matrix(text)
    except Exception:
        return top  # data too long for version 10 — fall back to URL text only
    n = len(mat)
    avail = min(max_width, max_height)
    scale = max(2, min(8, int(avail // (n + 8))))
    quiet = scale * 4
    size = (n + quiet * 2) * scale
    x0 = cx - size // 2
    y0 = top
    # white background + quiet zone
    fill_rect(c, x0, y0, size, size, (0xFF, 0xFF, 0xFF))
    for my in range(n):
        for mx in range(n):
            if mat[my][mx]:
                fill_rect(c, x0 + quiet + mx * scale, y0 + quiet + my * scale,
                          scale, scale, (0x00, 0x00, 0x00))
    return y0 + size


def render_screen(c, w, h, state, ip, no_ip_seconds, stale_warning, stuck_warning) -> None:
    # Background
    vertical_gradient(c, w, h, NAVY_TOP, NAVY_BOTTOM)

    status = (state or {}).get("status", "pending") if state else "pending"
    percent = int((state or {}).get("percent", 0) or 0)
    phase = (state or {}).get("phase_label", "") if state else ""
    done = status == "done"
    failed = status == "failed"

    mark_scale = max(0.10, min(0.40, h * 0.18 / LOGO_SIZE))
    mark = build_logo_mark(mark_scale)
    cx = w // 2
    cy = int(h * 0.14)
    stamp_mark(c, mark, cx, cy, mark_scale)

    title_scale = fit_scale("IORA OS", 6, w - 60)
    draw_text(c, cx, cy + int(mark_scale * LOGO_SIZE / 2) + 10, "IORA OS", title_scale, TEXT, align="center")

    tagline_scale = fit_scale("Interface for Optimized Residential Autonomy", 2, w - 40)
    draw_text(c, cx, cy + int(mark_scale * LOGO_SIZE / 2) + 14 + title_scale * 8,
              "Interface for Optimized Residential Autonomy", tagline_scale, TEXT_DIM, align="center")

    # Status card
    card_w = min(int(w * 0.72), 980)
    card_h = min(250, int(h * 0.30))
    card_x = (w - card_w) // 2
    card_y = int(h * 0.40)
    fill_rounded_rect(c, card_x, card_y, card_w, card_h, 16, SURFACE)
    pad = 26
    inner_w = card_w - pad * 2
    cx_card = card_x + card_w // 2

    # Status row
    if done:
        status_color = GREEN
        status_label = "SETUP COMPLETE"
    elif failed:
        status_color = RED
        status_label = "SETUP FAILED"
    elif status == "running":
        status_color = ACCENT_LIGHT
        status_label = "INSTALLING IORA OS"
    else:
        status_color = YELLOW
        status_label = "SETUP NOT STARTED"

    y = card_y + 22
    label_scale = fit_scale(status_label, 3, inner_w)
    draw_text(c, card_x + pad, y, status_label, label_scale, status_color)
    pct_scale = 4
    pct_text = f"{percent:3d}%"
    draw_text(c, card_x + card_w - pad - text_width(pct_text, pct_scale), y, pct_text, pct_scale, TEXT if not done else GREEN)

    # Progress bar
    bar_y = y + label_scale * 8 + 20
    bar_h = 16
    fill_rounded_rect(c, card_x + pad, bar_y, inner_w, bar_h, bar_h // 2, (0x1C, 0x20, 0x2C))
    fill_w = int(inner_w * percent / 100)
    if fill_w > 0:
        for bx in range(fill_w):
            t = bx / max(1, inner_w)
            col = tuple(int(ACCENT[i] + (CYAN[i] - ACCENT[i]) * t) for i in range(3))
            fill_rect(c, card_x + pad + bx, bar_y, 1, bar_h, col)

    # Phase / warnings / log
    y2 = bar_y + bar_h + 18
    if done:
        draw_text(c, cx_card, y2, "IORA OS dashboard ready", fit_scale("IORA OS dashboard ready", 2, inner_w), GREEN, align="center")
        y2 += 30
        url = f"http://{ip or '<device-ip>'}:{DASHBOARD_PORT}"
        draw_text(c, cx_card, y2, url, fit_scale(url, 3, inner_w), TEXT, align="center")
        # Recovery PIN (written by the headless apply for the installer flow).
        try:
            with open("/etc/iora/recovery-pin", "r") as _f:
                pin = _f.read().strip()
            if pin:
                y2 += 44
                draw_text(c, cx_card, y2, "Recovery PIN - write it down", 2, YELLOW, align="center")
                y2 += 26
                pin_scale = fit_scale(pin, 3, inner_w)
                draw_text(c, cx_card, y2, pin, pin_scale, TEXT, align="center")
        except Exception:
            pass
    else:
        phase_scale = fit_scale(phase or "Waiting for the wizard to start...", 2, inner_w)
        draw_text(c, card_x + pad, y2, phase or "Waiting for the wizard to start...", phase_scale, TEXT_DIM)
        y2 += phase_scale * 8 + 14

        if stale_warning:
            draw_text(c, card_x + pad, y2, f"[!] {stale_warning[:52]}", 2, RED)
            y2 += 22
        if stuck_warning:
            draw_text(c, card_x + pad, y2, f"[!] {stuck_warning[:52]}", 2, YELLOW)
            y2 += 22
        if not ip:
            draw_text(c, card_x + pad, y2, "[!] No IP address detected - check the network cable", 2, YELLOW)
            y2 += 22

        log = (state or {}).get("log") or []
        if log:
            for entry in log[-3:]:
                msg = (entry.get("msg") or "")[:58]
                lvl = entry.get("level", "info")
                col = LOG_ERR if lvl == "error" else TEXT_FAINT
                draw_text(c, card_x + pad, y2, msg, 1, col)
                y2 += 12

        errors = (state or {}).get("errors") or []
        if errors and status not in ("running",):
            y2 += 6
            for e in errors[-2:]:
                draw_text(c, card_x + pad, y2, f"* {e[:58]}", 1, RED)
                y2 += 12

    # URL block (open on another device)
    y3 = card_y + card_h + 28
    hint_scale = fit_scale("Open the setup wizard on another device", 2, w - 40)
    draw_text(c, cx, y3, "Open the setup wizard on another device", hint_scale, TEXT_DIM, align="center")
    y4 = y3 + hint_scale * 8 + 8
    url = f"http://{ip or '<device-ip>'}:{SETUP_PORT}/setup"
    url_scale = fit_scale(url, 3, int(w * 0.9))
    draw_text(c, cx, y4, url, url_scale, ACCENT_LIGHT, align="center")

    # Scannable QR code for the URL (scan with a phone instead of typing).
    qr_top = y4 + url_scale * 8 + 12
    qr_top = draw_qr(c, cx, qr_top, url, int(w * 0.9), h - qr_top - 40)

    if not ip and no_ip_seconds >= NO_IP_PROMPT_AFTER:
        y5 = qr_top + 10
        draw_text(c, cx, y5, "No IP detected - use the recovery console (tty1) for static IP", 1, YELLOW, align="center")

    # Footer
    footer_scale = fit_scale("IORA OS  -  Interface for Optimized Residential Autonomy", 1, w - 20)
    draw_text(c, cx, h - 24, "IORA OS  -  Interface for Optimized Residential Autonomy", footer_scale, TEXT_FAINT, align="center")


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="IORA first-boot GUI (framebuffer)")
    ap.add_argument("--ppm", metavar="FILE", help="render one frame to a PPM file (dev/verification)")
    ap.add_argument("--size", default="1920x1080", help="PPM render size (default 1920x1080)")
    ap.add_argument("--state", help="override state file (dev)")
    args = ap.parse_args()

    global STATE_FILE
    if args.state:
        STATE_FILE = args.state

    canvas, w, h = open_canvas(args)

    if args.ppm:
        ip = get_primary_ip()
        state = load_state()
        render_screen(canvas, w, h, state, ip, 0, "", "")
        canvas.save(args.ppm)
        return 0

    # The GUI only writes to the framebuffer, not the console, so the
    # kernel VT blank timer would dim the screen after ~10 min while the
    # wizard waits for the user. Disable blanking for the setup phase.
    try:
        subprocess.run(["setterm", "-blank", "0", "-powersave", "off"],
                       check=False, capture_output=True, timeout=3)
    except Exception:
        pass

    # Framebuffer loop — mirror the TUI lifecycle.
    last_key = ""
    last_render = 0.0
    last_ip_check = 0.0
    ip = ""
    no_ip_since: float | None = None
    last_running_update = 0.0
    last_percent = -1
    last_percent_change = 0.0
    try:
        while True:
            if setup_done():
                state = {"status": "done", "percent": 100}
                render_screen(canvas, w, h, state, ip, 0, "", "")
                time.sleep(4)
                return 0

            now = time.time()
            if now - last_ip_check > 5 or not ip:
                ip = get_primary_ip()
                last_ip_check = now
                if ip:
                    no_ip_since = None
                elif no_ip_since is None:
                    no_ip_since = now
            no_ip_secs = (now - no_ip_since) if (not ip and no_ip_since is not None) else 0.0

            state = load_state()
            stale_warning = ""
            stuck_warning = ""
            if state and state.get("status") == "running":
                updated_at = state.get("updated_at")
                if updated_at:
                    if last_running_update == 0:
                        last_running_update = float(updated_at)
                    age = now - float(updated_at)
                    if age > STALE_RUN_WARN_SECONDS:
                        stale_warning = f"Setup has been running for {int(age)}s without updates."
                pct = state.get("percent", -1)
                if pct != last_percent:
                    last_percent = pct
                    last_percent_change = now
                elif now - last_percent_change > STUCK_PERCENT_WARN_SECONDS and pct < 100:
                    stuck_warning = f"Progress stuck at {pct}%."
            else:
                last_running_update = 0.0
                last_percent = -1
                last_percent_change = 0.0

            key = state_change_key(state, ip) + f"|{stale_warning}|{stuck_warning}"
            # Redraw on state change; also heartbeat every 30 s so a long
            # idle wait (no changes) still refreshes the panel.
            if key != last_key or now - last_render >= 30:
                render_screen(canvas, w, h, state, ip, no_ip_secs, stale_warning, stuck_warning)
                last_key = key
                last_render = now
            time.sleep(1.0)
    except KeyboardInterrupt:
        return 0
    finally:
        canvas.close()


if __name__ == "__main__":
    raise SystemExit(main())
